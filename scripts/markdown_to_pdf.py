#!/usr/bin/env python3
"""Render the admin endpoint Markdown reference as a dependency-free PDF."""

from __future__ import annotations

import re
import sys
import unicodedata
from pathlib import Path
from textwrap import wrap


PAGE_WIDTH = 612
PAGE_HEIGHT = 792
LEFT = 54
TOP = 744
BOTTOM = 54
BODY_SIZE = 9
BODY_LEADING = 12


def clean_inline(text: str) -> str:
    text = re.sub(r"\[([^]]+)\]\([^)]+\)", r"\1", text)
    text = text.replace("`", "").replace("**", "")
    text = text.replace("&lt;", "<").replace("&gt;", ">")
    text = unicodedata.normalize("NFKD", text)
    return text.encode("latin-1", "replace").decode("latin-1")


def width_chars(size: float, mono: bool = False) -> int:
    usable = PAGE_WIDTH - 2 * LEFT
    average = size * (0.60 if mono else 0.51)
    return max(24, int(usable / average))


def parse_markdown(markdown: str) -> list[tuple[str, str, float, float]]:
    rendered: list[tuple[str, str, float, float]] = []
    code = False
    table_headers: list[str] | None = None

    def emit_wrapped(text: str, font: str, size: float, indent: float = 0) -> None:
        mono = font == "F3"
        limit = max(20, width_chars(size, mono) - int(indent / (size * 0.55)))
        for line in wrap(text, width=limit, subsequent_indent="", break_long_words=True, break_on_hyphens=False) or [""]:
            rendered.append((line, font, size, indent))

    for raw in markdown.splitlines():
        line = raw.rstrip()
        if line.startswith("```"):
            code = not code
            rendered.append(("", "F1", 4, 0))
            continue

        if code:
            emit_wrapped(clean_inline(line), "F3", 8, 12)
            continue

        if not line.strip() or line.strip() == "---":
            table_headers = None if not line.strip() else table_headers
            rendered.append(("", "F1", 5, 0))
            continue

        heading = re.match(r"^(#{1,3})\s+(.*)$", line)
        if heading:
            level = len(heading.group(1))
            size = {1: 20, 2: 15, 3: 11}[level]
            rendered.append(("", "F1", 5 if level == 1 else 3, 0))
            emit_wrapped(clean_inline(heading.group(2)), "F2", size, 0)
            rendered.append(("", "F1", 3 if level == 1 else 2, 0))
            continue

        if line.startswith("|") and line.endswith("|"):
            cells = [clean_inline(cell.strip()) for cell in line.strip("|").split("|")]
            if all(re.fullmatch(r":?-{3,}:?", cell.replace(" ", "")) for cell in cells):
                continue
            if table_headers is None:
                table_headers = cells
                continue
            pairs = [f"{name}: {value}" for name, value in zip(table_headers, cells) if value]
            emit_wrapped("  |  ".join(pairs), "F1", BODY_SIZE, 6)
            rendered.append(("", "F1", 3, 0))
            continue

        bullet = re.match(r"^(\s*)[-*+]\s+(.*)$", line)
        if bullet:
            indent = min(32, 10 + len(bullet.group(1)) * 2)
            emit_wrapped("- " + clean_inline(bullet.group(2)), "F1", BODY_SIZE, indent)
            continue

        number = re.match(r"^(\s*\d+\.)\s+(.*)$", line)
        if number:
            emit_wrapped(number.group(1) + " " + clean_inline(number.group(2)), "F1", BODY_SIZE, 8)
            continue

        emit_wrapped(clean_inline(line), "F1", BODY_SIZE, 0)

    return rendered


def pdf_escape(text: str) -> bytes:
    safe = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    return safe.encode("latin-1", "replace")


def make_pages(lines: list[tuple[str, str, float, float]]) -> list[bytes]:
    pages: list[list[tuple[str, str, float, float, float]]] = [[]]
    y = TOP
    for text, font, size, indent in lines:
        leading = max(5, size * (1.35 if size >= 14 else 1.35))
        if y - leading < BOTTOM:
            pages.append([])
            y = TOP
        pages[-1].append((text, font, size, LEFT + indent, y))
        y -= leading

    streams: list[bytes] = []
    for page_number, page_lines in enumerate(pages, start=1):
        commands = [b"BT"]
        for text, font, size, x, y in page_lines:
            commands.extend(
                [
                    f"/{font} {size:.1f} Tf".encode("ascii"),
                    f"1 0 0 1 {x:.1f} {y:.1f} Tm".encode("ascii"),
                    b"(" + pdf_escape(text) + b") Tj",
                ]
            )
        commands.extend(
            [
                b"/F1 8 Tf",
                f"1 0 0 1 {LEFT} 30 Tm".encode("ascii"),
                b"(DAGH Admin API - Endpoint Reference) Tj",
                b"/F1 8 Tf",
                f"1 0 0 1 {PAGE_WIDTH - LEFT - 54} 30 Tm".encode("ascii"),
                b"(Page " + str(page_number).encode("ascii") + b") Tj",
                b"ET",
            ]
        )
        streams.append(b"\n".join(commands))
    return streams


def build_pdf(streams: list[bytes]) -> bytes:
    objects: list[bytes] = []
    page_ids = [6 + 2 * index for index in range(len(streams))]
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    kids = " ".join(f"{page_id} 0 R" for page_id in page_ids)
    objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {len(streams)} >>".encode("ascii"))
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>")

    for index, stream in enumerate(streams):
        page_id = page_ids[index]
        stream_id = page_id + 1
        page = (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_WIDTH} {PAGE_HEIGHT}] "
            f"/Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> "
            f"/Contents {stream_id} 0 R >>"
        ).encode("ascii")
        objects.append(page)
        objects.append(b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n" + stream + b"\nendstream")

    output = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for index, obj in enumerate(objects, start=1):
        offsets.append(len(output))
        output.extend(f"{index} 0 obj\n".encode("ascii"))
        output.extend(obj)
        output.extend(b"\nendobj\n")

    xref_position = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    output.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    output.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_position}\n%%EOF\n".encode(
            "ascii"
        )
    )
    return bytes(output)


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Usage: python3 scripts/markdown_to_pdf.py INPUT.md OUTPUT.pdf")
    source = Path(sys.argv[1])
    destination = Path(sys.argv[2])
    markdown = source.read_text(encoding="utf-8")
    pdf = build_pdf(make_pages(parse_markdown(markdown)))
    destination.write_bytes(pdf)
    print(f"Wrote {destination} ({len(pdf)} bytes)")


if __name__ == "__main__":
    main()
