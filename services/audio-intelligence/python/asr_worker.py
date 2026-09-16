"""Offline local-ASR worker.

The worker accepts little-endian float32 mono samples on stdin and emits JSON on
stdout. It never downloads models: callers must provide an existing local model
directory and the process is forced into offline hub mode.
"""

from __future__ import annotations

import argparse
import contextlib
import io
import json
import re
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def fail(message: str) -> None:
    print(json.dumps({"error": message}, ensure_ascii=False))


def confidence_from_logprob(value: object) -> float | None:
    if not isinstance(value, (int, float)):
        return None
    # A bounded diagnostic proxy, not a calibrated probability.
    return max(0.0, min(1.0, (float(value) + 2.0) / 2.0))


def sensevoice(samples, args: argparse.Namespace) -> list[dict[str, object]]:
    # FunASR emits progress/version notices to stdout. Keep the worker's stdout
    # JSON-only contract intact while preserving the real model output.
    with contextlib.redirect_stdout(io.StringIO()):
        from funasr import AutoModel  # type: ignore[import-not-found]

        model = AutoModel(model=str(args.model_dir), device=args.device, disable_update=True, disable_pbar=True)
        output = model.generate(
            input=samples,
            sampling_rate=args.sample_rate,
            language="zh",
            use_itn=True,
            batch_size_s=60,
            disable_pbar=True,
        )
    if not isinstance(output, list):
        output = [output]
    segments: list[dict[str, object]] = []
    for item in output:
        if not isinstance(item, dict):
            continue
        text = re.sub(r"<\|[^|]+\|>", "", str(item.get("text", ""))).strip()
        if text and not isinstance(item.get("sentence_info"), list) and not isinstance(item.get("timestamp"), list):
            segments.append(
                {
                    "start_ms": 0,
                    "end_ms": int(round(len(samples) * 1000 / args.sample_rate)),
                    "text": text,
                    "confidence": None,
                }
            )
            continue
        sentence_info = item.get("sentence_info")
        timestamps = item.get("timestamp")
        candidates = sentence_info if isinstance(sentence_info, list) else timestamps
        if not text or not isinstance(candidates, list):
            continue
        for sentence in candidates:
            if not isinstance(sentence, dict):
                continue
            start = sentence.get("start")
            end = sentence.get("end")
            sentence_text = str(sentence.get("text", text)).strip()
            if isinstance(start, (int, float)) and isinstance(end, (int, float)) and end > start and sentence_text:
                segments.append({"start_ms": int(start), "end_ms": int(end), "text": sentence_text, "confidence": None})
    return segments


def faster_whisper(samples, args: argparse.Namespace) -> list[dict[str, object]]:
    from faster_whisper import WhisperModel  # type: ignore[import-not-found]

    model = WhisperModel(str(args.model_dir), device=args.device, compute_type=args.compute_type)
    generated, _info = model.transcribe(
        samples,
        language="zh",
        vad_filter=False,
        word_timestamps=False,
    )
    segments: list[dict[str, object]] = []
    for item in generated:
        text = str(getattr(item, "text", "")).strip()
        start = float(getattr(item, "start", -1))
        end = float(getattr(item, "end", -1))
        if text and start >= 0 and end > start:
            segments.append(
                {
                    "start_ms": int(round(start * 1000)),
                    "end_ms": int(round(end * 1000)),
                    "text": text,
                    "confidence": confidence_from_logprob(getattr(item, "avg_logprob", None)),
                }
            )
    return segments


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--backend", choices=("sensevoice", "faster-whisper"), required=True)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--sample-rate", type=int, required=True)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute-type", default="int8")
    args = parser.parse_args()
    if not args.model_dir.is_dir():
        fail(f"model directory does not exist: {args.model_dir}")
        return 2
    raw = sys.stdin.buffer.read()
    if not raw or len(raw) % 4:
        fail("worker input must be non-empty float32 bytes")
        return 2
    try:
        import numpy as np

        samples = np.frombuffer(raw, dtype="<f4")
        segments = sensevoice(samples, args) if args.backend == "sensevoice" else faster_whisper(samples, args)
        if not segments:
            fail("ASR returned no timestamped transcript segments")
            return 3
        print(json.dumps({"segments": segments}, ensure_ascii=False))
        return 0
    except Exception as exc:  # noqa: BLE001 - boundary must return a safe machine error
        fail(f"{args.backend} local runtime failed: {type(exc).__name__}: {exc}")
        return 4


if __name__ == "__main__":
    raise SystemExit(main())
