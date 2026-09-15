"""Offline file inspection and OCR worker for Phase 2.

The worker accepts one JSON object on stdin and writes one JSON object to stdout.
It never logs source text, image bytes, or OCR payloads.
"""

from __future__ import annotations

import base64
import io
import json
import sys
from typing import Any


def result(**payload: Any) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    sys.stdout.flush()


def failure(code: str, message: str) -> None:
    result(status="failed", code=code, message=message)


def decode_content(payload: dict[str, Any]) -> bytes | None:
    encoded = payload.get("content_base64")
    if not isinstance(encoded, str) or not encoded:
        failure("EMPTY_FILE", "文件内容为空")
        return None
    try:
        content = base64.b64decode(encoded, validate=True)
    except (ValueError, base64.binascii.Error):
        failure("MALFORMED_FILE", "文件 Base64 内容损坏")
        return None
    if not content:
        failure("EMPTY_FILE", "文件内容为空")
        return None
    return content


def inspect_image(content: bytes, content_type: str) -> None:
    try:
        from PIL import Image

        with Image.open(io.BytesIO(content)) as image:
            image.verify()
    except Exception:
        failure("MALFORMED_FILE", "图片文件损坏或格式与声明不匹配")
        return
    if content_type == "image/png":
        source = "png"
    elif content_type == "image/jpeg":
        source = "jpeg"
    else:
        failure("UNSUPPORTED_FILE", "不支持的图片类型")
        return
    result(status="ocr_required", source=source)


def inspect_pdf(content: bytes) -> None:
    if not content.startswith(b"%PDF-"):
        failure("MALFORMED_FILE", "PDF 文件头无效")
        return
    try:
        import pymupdf as fitz

        document = fitz.open(stream=content, filetype="pdf")
    except Exception:
        failure("MALFORMED_FILE", "PDF 文件损坏或无法读取")
        return
    try:
        if document.needs_pass:
            failure("ENCRYPTED_FILE", "加密 PDF 不能在未授权状态下提取")
            return
        if document.page_count == 0:
            failure("EMPTY_FILE", "PDF 没有页面")
            return
        text = "\n".join(page.get_text("text") for page in document)
        if text.strip():
            result(
                status="text",
                source="pdf_text",
                text=text,
                provider="pymupdf",
                version=getattr(fitz, "VersionBind", "unknown"),
                page_count=document.page_count,
            )
        else:
            result(status="ocr_required", source="scanned_pdf", page_count=document.page_count)
    finally:
        document.close()


def ocr_image(image: Any, engine: Any) -> list[tuple[float, float, str]]:
    import numpy as np

    if hasattr(image, "convert"):
        image = image.convert("RGB")
        image = np.asarray(image)
    output, _ = engine(image)
    if not output:
        return []
    lines: list[tuple[float, float, str]] = []
    for item in output:
        if len(item) < 3:
            continue
        box, text, score = item[0], str(item[1]).strip(), float(item[2])
        if not text or score < 0.25:
            continue
        top = min(float(point[1]) for point in box)
        left = min(float(point[0]) for point in box)
        lines.append((top, left, text))
    lines.sort(key=lambda item: (round(item[0] / 12), item[1]))
    return lines


def run_ocr(content: bytes, content_type: str) -> None:
    try:
        from PIL import Image
        from rapidocr_onnxruntime import RapidOCR
    except Exception:
        failure("OCR_FAILED", "本地 RapidOCR 依赖不可用")
        return

    engine = RapidOCR()
    pages: list[Any] = []
    if content_type in {"image/png", "image/jpeg"}:
        try:
            pages.append(Image.open(io.BytesIO(content)))
        except Exception:
            failure("MALFORMED_FILE", "图片文件损坏或无法读取")
            return
    elif content_type == "application/pdf":
        if not content.startswith(b"%PDF-"):
            failure("MALFORMED_FILE", "PDF 文件头无效")
            return
        try:
            import pymupdf as fitz

            document = fitz.open(stream=content, filetype="pdf")
        except Exception:
            failure("MALFORMED_FILE", "PDF 文件损坏或无法读取")
            return
        try:
            if document.needs_pass:
                failure("ENCRYPTED_FILE", "加密 PDF 不能在未授权状态下提取")
                return
            if document.page_count == 0:
                failure("EMPTY_FILE", "PDF 没有页面")
                return
            for page in document:
                pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
                channels = 3 if pixmap.n < 4 else 4
                import numpy as np

                array = np.frombuffer(pixmap.samples, dtype=np.uint8)
                pages.append(array.reshape(pixmap.height, pixmap.width, channels)[:, :, :3])
        finally:
            document.close()
    else:
        failure("UNSUPPORTED_FILE", "不支持的 OCR 文件类型")
        return

    lines: list[tuple[float, float, str]] = []
    for page_index, page in enumerate(pages):
        for top, left, text in ocr_image(page, engine):
            lines.append((page_index * 1_000_000 + top, left, text))
    lines.sort(key=lambda item: (item[0], item[1]))
    text = "\n".join(item[2] for item in lines).strip()
    if not text:
        failure("OCR_EMPTY", "OCR 未识别到可用文字")
        return
    result(
        status="succeeded",
        text=text,
        provider="rapidocr-onnxruntime",
        version="offline-runtime",
        page_count=len(pages),
        line_count=len(lines),
    )


def main() -> None:
    try:
        payload = json.loads(sys.stdin.read())
    except Exception:
        failure("MALFORMED_FILE", "worker 输入不是有效 JSON")
        return
    if not isinstance(payload, dict):
        failure("MALFORMED_FILE", "worker 输入必须是 JSON 对象")
        return
    content = decode_content(payload)
    if content is None:
        return
    mode = payload.get("mode")
    content_type = payload.get("content_type")
    if not isinstance(content_type, str):
        failure("UNSUPPORTED_FILE", "文件类型缺失")
        return
    if mode == "inspect":
        if content_type in {"image/png", "image/jpeg"}:
            inspect_image(content, content_type)
        elif content_type == "application/pdf":
            inspect_pdf(content)
        else:
            failure("UNSUPPORTED_FILE", "不支持的文件类型")
    elif mode == "ocr":
        run_ocr(content, content_type)
    else:
        failure("UNSUPPORTED_FILE", "worker 模式不支持")


if __name__ == "__main__":
    main()
