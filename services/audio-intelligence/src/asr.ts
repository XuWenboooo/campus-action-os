import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AsrFailure, AsrInput, AsrProvider, TranscriptSegment } from './types.js';

export type AsrAuditEvent = {
  event: 'attempt' | 'primary_failure' | 'fallback' | 'success' | 'failure';
  request_id: string;
  audio_id: string;
  provider: string;
  fallback_from?: string;
  code?: string;
};

export type LocalPythonAsrOptions = {
  model_dir: string;
  python_command?: string;
  worker_path?: string;
  timeout_ms?: number;
  device?: string;
  compute_type?: string;
  env?: Record<string, string>;
};

type LocalBackend = 'sensevoice' | 'faster-whisper';

function contextFailure(
  input: AsrInput,
  code: AsrFailure['code'],
  message: string,
  retryable: boolean,
): AsrFailure {
  return {
    code,
    message,
    retryable,
    request_id: input.request_id,
    audio_id: input.audio_id,
    raw_audio_hash: input.provenance.raw_audio_hash,
  };
}

function isConfidence(value: unknown): value is number | null | undefined {
  return (
    value === null || value === undefined || (typeof value === 'number' && value >= 0 && value <= 1)
  );
}

function validateSegments(
  input: AsrInput,
  provider: string,
  segments: unknown,
): TranscriptSegment[] | AsrFailure {
  if (!Array.isArray(segments) || segments.length === 0)
    return contextFailure(
      input,
      'ASR_EMPTY_TRANSCRIPT',
      'ASR returned no transcript segments',
      true,
    );
  const seen = new Set<string>();
  let previousStart = -1;
  const validated: TranscriptSegment[] = [];
  for (const [index, candidate] of segments.entries()) {
    if (!candidate || typeof candidate !== 'object')
      return contextFailure(
        input,
        'ASR_INVALID_RESULT',
        `ASR segment ${index} is not an object`,
        false,
      );
    const value = candidate as Partial<TranscriptSegment>;
    if (
      typeof value.segment_id !== 'string' ||
      !value.segment_id ||
      seen.has(value.segment_id) ||
      typeof value.text !== 'string' ||
      !value.text.trim() ||
      typeof value.provider !== 'string' ||
      value.provider !== provider ||
      value.source_audio_id !== input.audio_id ||
      typeof value.start_ms !== 'number' ||
      typeof value.end_ms !== 'number' ||
      !Number.isFinite(value.start_ms) ||
      !Number.isFinite(value.end_ms) ||
      value.start_ms < input.segment.start_ms ||
      value.end_ms > input.segment.end_ms ||
      value.end_ms <= value.start_ms ||
      value.start_ms < previousStart ||
      !isConfidence(value.confidence)
    )
      return contextFailure(
        input,
        'ASR_INVALID_RESULT',
        `ASR segment ${index} failed timestamp/schema validation`,
        false,
      );
    seen.add(value.segment_id);
    previousStart = value.start_ms;
    validated.push({
      segment_id: value.segment_id,
      start_ms: value.start_ms,
      end_ms: value.end_ms,
      text: value.text.trim(),
      confidence: value.confidence ?? null,
      provider: value.provider,
      ...(value.speaker_id ? { speaker_id: value.speaker_id } : {}),
      source_audio_id: value.source_audio_id,
    });
  }
  return validated;
}

function mapWorkerSegments(
  input: AsrInput,
  provider: string,
  segments: unknown,
): TranscriptSegment[] | AsrFailure {
  if (!Array.isArray(segments) || segments.length === 0)
    return contextFailure(
      input,
      'ASR_EMPTY_TRANSCRIPT',
      'ASR worker returned no transcript segments',
      true,
    );
  const mapped: unknown[] = [];
  for (const [index, candidate] of segments.entries()) {
    if (!candidate || typeof candidate !== 'object')
      return contextFailure(
        input,
        'ASR_INVALID_RESULT',
        `ASR worker segment ${index} is not an object`,
        false,
      );
    const value = candidate as {
      start_ms?: unknown;
      end_ms?: unknown;
      text?: unknown;
      confidence?: unknown;
    };
    if (
      typeof value.start_ms !== 'number' ||
      typeof value.end_ms !== 'number' ||
      !Number.isFinite(value.start_ms) ||
      !Number.isFinite(value.end_ms) ||
      value.start_ms < 0 ||
      value.end_ms <= value.start_ms ||
      value.end_ms > input.segment.end_ms - input.segment.start_ms ||
      typeof value.text !== 'string' ||
      !value.text.trim() ||
      !isConfidence(value.confidence)
    )
      return contextFailure(
        input,
        'ASR_INVALID_RESULT',
        `ASR worker segment ${index} failed validation`,
        false,
      );
    mapped.push({
      segment_id: `${input.segment.segment_id}-asr-${index + 1}`,
      start_ms: input.segment.start_ms + value.start_ms,
      end_ms: input.segment.start_ms + value.end_ms,
      text: value.text,
      confidence: value.confidence ?? null,
      provider,
      source_audio_id: input.audio_id,
    });
  }
  return validateSegments(input, provider, mapped);
}

export class LocalPythonAsrProvider implements AsrProvider {
  readonly name: string;
  private readonly backend: LocalBackend;
  private readonly modelDir: string;
  private readonly pythonCommand: string;
  private readonly workerPath: string;
  private readonly timeoutMs: number;
  private readonly device: string;
  private readonly computeType: string;
  private readonly env: Record<string, string>;

  constructor(backend: LocalBackend, options: LocalPythonAsrOptions) {
    this.backend = backend;
    this.name = `${backend}-local`;
    this.modelDir = options.model_dir;
    this.pythonCommand = options.python_command ?? 'python';
    this.workerPath =
      options.worker_path ?? fileURLToPath(new URL('../python/asr_worker.py', import.meta.url));
    this.timeoutMs = Math.max(1000, options.timeout_ms ?? 60_000);
    this.device = options.device ?? 'cpu';
    this.computeType = options.compute_type ?? 'int8';
    this.env = options.env ?? {};
  }

  async transcribe(
    input: AsrInput,
    signal?: AbortSignal,
  ): Promise<TranscriptSegment[] | AsrFailure> {
    if (signal?.aborted)
      return contextFailure(input, 'ASR_UNAVAILABLE', 'ASR request was cancelled', false);
    if (!existsSync(this.modelDir) || !statSync(this.modelDir).isDirectory())
      return contextFailure(
        input,
        'ASR_MODEL_MISSING',
        `ASR model directory is missing: ${this.modelDir}`,
        true,
      );
    if (!existsSync(this.workerPath))
      return contextFailure(
        input,
        'ASR_WORKER_MISSING',
        `ASR worker is missing: ${this.workerPath}`,
        false,
      );

    const rawSamples = Buffer.from(
      input.segment.samples.buffer,
      input.segment.samples.byteOffset,
      input.segment.samples.byteLength,
    );
    const args = [
      this.workerPath,
      '--backend',
      this.backend,
      '--model-dir',
      this.modelDir,
      '--sample-rate',
      String(input.sample_rate),
      '--device',
      this.device,
      '--compute-type',
      this.computeType,
    ];
    return new Promise((resolve) => {
      const child = spawn(this.pythonCommand, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', ...this.env },
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      let timedOut = false;
      const finish = (result: TranscriptSegment[] | AsrFailure): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        resolve(result);
      };
      const abort = (): void => {
        child.kill();
        finish(contextFailure(input, 'ASR_UNAVAILABLE', 'ASR request was cancelled', false));
      };
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
        finish(contextFailure(input, 'ASR_TIMEOUT', 'Local ASR provider timed out', true));
      }, this.timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout = `${stdout}${chunk}`.slice(-4_000_000);
      });
      child.stderr.on('data', (chunk: string) => {
        stderr = `${stderr}${chunk}`.slice(-8_000);
      });
      child.on('error', () => {
        finish(
          contextFailure(
            input,
            'ASR_RUNTIME_UNAVAILABLE',
            'Local ASR Python runtime could not start',
            true,
          ),
        );
      });
      child.on('close', (code) => {
        if (settled) return;
        if (timedOut) return;
        if (code !== 0)
          return finish(
            contextFailure(
              input,
              code === 3 ? 'ASR_EMPTY_TRANSCRIPT' : 'ASR_UNAVAILABLE',
              stderr.trim()
                ? `Local ASR runtime failed: ${stderr.trim().slice(0, 500)}`
                : 'Local ASR runtime failed',
              true,
            ),
          );
        try {
          const payload = JSON.parse(stdout) as { segments?: unknown; error?: string };
          if (payload.error)
            return finish(contextFailure(input, 'ASR_INVALID_RESULT', payload.error, false));
          return finish(mapWorkerSegments(input, this.name, payload.segments));
        } catch {
          return finish(
            contextFailure(
              input,
              'ASR_INVALID_RESULT',
              'Local ASR worker returned malformed JSON',
              false,
            ),
          );
        }
      });
      child.stdin.on('error', () => undefined);
      child.stdin.end(rawSamples);
    });
  }
}

export class SenseVoiceLocalProvider extends LocalPythonAsrProvider {
  constructor(options: LocalPythonAsrOptions) {
    super('sensevoice', options);
  }
}

export class FasterWhisperLocalProvider extends LocalPythonAsrProvider {
  constructor(options: LocalPythonAsrOptions) {
    super('faster-whisper', options);
  }
}

export type FailoverOptions = {
  on_audit?: (event: AsrAuditEvent) => void;
};

function failureWithContext(input: AsrInput, failure: AsrFailure): AsrFailure {
  return {
    ...failure,
    request_id: failure.request_id ?? input.request_id,
    audio_id: failure.audio_id ?? input.audio_id,
    raw_audio_hash: failure.raw_audio_hash ?? input.provenance.raw_audio_hash,
  };
}

export class AuditableAsrFailover implements AsrProvider {
  readonly name: string;
  private readonly primary: AsrProvider;
  private readonly fallback: AsrProvider;
  private readonly onAudit: (event: AsrAuditEvent) => void;

  constructor(primary: AsrProvider, fallback: AsrProvider, options: FailoverOptions = {}) {
    this.primary = primary;
    this.fallback = fallback;
    this.name = `${primary.name}->${fallback.name}`;
    this.onAudit = options.on_audit ?? (() => undefined);
  }

  async transcribe(
    input: AsrInput,
    signal?: AbortSignal,
  ): Promise<TranscriptSegment[] | AsrFailure> {
    this.onAudit({
      event: 'attempt',
      request_id: input.request_id,
      audio_id: input.audio_id,
      provider: this.primary.name,
    });
    const primary = await this.invoke(this.primary, input, signal);
    if (!('code' in primary)) {
      this.onAudit({
        event: 'success',
        request_id: input.request_id,
        audio_id: input.audio_id,
        provider: this.primary.name,
      });
      return primary;
    }
    this.onAudit({
      event: 'primary_failure',
      request_id: input.request_id,
      audio_id: input.audio_id,
      provider: this.primary.name,
      code: primary.code,
    });
    if (signal?.aborted) return primary;
    this.onAudit({
      event: 'fallback',
      request_id: input.request_id,
      audio_id: input.audio_id,
      provider: this.fallback.name,
      fallback_from: this.primary.name,
      code: primary.code,
    });
    const fallback = await this.invoke(this.fallback, input, signal);
    if (!('code' in fallback)) {
      this.onAudit({
        event: 'success',
        request_id: input.request_id,
        audio_id: input.audio_id,
        provider: this.fallback.name,
      });
      return fallback;
    }
    const finalFailure = contextFailure(
      input,
      'ASR_BOTH_PROVIDERS_FAILED',
      `Primary ${this.primary.name} failed with ${primary.code}; fallback ${this.fallback.name} failed with ${fallback.code}`,
      false,
    );
    this.onAudit({
      event: 'failure',
      request_id: input.request_id,
      audio_id: input.audio_id,
      provider: this.name,
      code: finalFailure.code,
    });
    return finalFailure;
  }

  private async invoke(
    provider: AsrProvider,
    input: AsrInput,
    signal?: AbortSignal,
  ): Promise<TranscriptSegment[] | AsrFailure> {
    try {
      const result = await provider.transcribe(input, signal);
      if ('code' in result) return failureWithContext(input, result);
      return validateSegments(input, provider.name, result);
    } catch {
      return contextFailure(
        input,
        'ASR_RUNTIME_UNAVAILABLE',
        `${provider.name} threw a runtime exception`,
        true,
      );
    }
  }
}

export function createLocalAsrFailover(options: {
  primary: LocalPythonAsrOptions;
  fallback: LocalPythonAsrOptions;
  on_audit?: (event: AsrAuditEvent) => void;
}): AuditableAsrFailover {
  return new AuditableAsrFailover(
    new SenseVoiceLocalProvider(options.primary),
    new FasterWhisperLocalProvider(options.fallback),
    { on_audit: options.on_audit },
  );
}
