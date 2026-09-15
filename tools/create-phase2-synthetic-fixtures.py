"""Create small, synthetic, non-production files for Phase 2 integration tests."""

from __future__ import annotations

import sys
from pathlib import Path


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: create-phase2-synthetic-fixtures.py OUTPUT_DIR")
    output = Path(sys.argv[1])
    output.mkdir(parents=True, exist_ok=True)

    import pymupdf as fitz
    from PIL import Image, ImageDraw, ImageFont

    font_candidates = [
        Path(r"C:\Windows\Fonts\msyh.ttc"),
        Path(r"C:\Windows\Fonts\simsun.ttc"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]
    font_path = next((path for path in font_candidates if path.exists()), None)
    font = ImageFont.truetype(str(font_path), 42) if font_path else ImageFont.load_default()
    image = Image.new("RGB", (1200, 360), "white")
    draw = ImageDraw.Draw(image)
    lines = ["适用对象：本科生", "1. 提交材料", "截止：2099-10-03 17:00 前"]
    for index, line in enumerate(lines):
        draw.text((40, 35 + index * 95), line, font=font, fill="black")
    png_path = output / "synthetic-screenshot.png"
    jpeg_path = output / "synthetic-screenshot.jpg"
    image.save(png_path, format="PNG")
    image.save(jpeg_path, format="JPEG", quality=95)

    text_pdf = fitz.open()
    page = text_pdf.new_page()
    page.insert_text((72, 100), "Synthetic text layer notice\nSubmit materials by 2099-10-03", fontsize=18)
    text_pdf.save(output / "text-layer.pdf")
    text_pdf.close()

    scanned_pdf = fitz.open()
    page = scanned_pdf.new_page(width=900, height=260)
    page.insert_image(page.rect, stream=jpeg_path.read_bytes())
    scanned_pdf.save(output / "scanned.pdf")
    scanned_pdf.close()

    # PyMuPDF cannot serialize a zero-page PDF; a zero-byte file is the
    # canonical empty-file fixture and is rejected before PDF parsing.
    (output / "empty.pdf").write_bytes(b"")

    encrypted_pdf = fitz.open()
    encrypted_page = encrypted_pdf.new_page()
    encrypted_page.insert_text((72, 100), "synthetic encrypted notice", fontsize=18)
    encrypted_pdf.save(
        output / "encrypted.pdf",
        encryption=fitz.PDF_ENCRYPT_AES_256,
        owner_pw="synthetic-owner",
        user_pw="synthetic-user",
    )
    encrypted_pdf.close()

    (output / "malformed.pdf").write_bytes(b"%PDF-synthetic-corrupted")


if __name__ == "__main__":
    main()
