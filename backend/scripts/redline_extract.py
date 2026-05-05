#!/usr/bin/env python3
"""
Read PDF bytes from stdin, detect color-based redlines, output marked-up text to stdout.
Requires: pip install pymupdf
"""
import sys
import io

def color_dist(a, b):
    return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5

def is_red(c):   return color_dist(c, (1.0, 0.0, 0.0)) < 0.30
def is_blue(c):  return color_dist(c, (0.0, 0.0, 1.0)) < 0.30
def is_green(c): return color_dist(c, (0.0, 0.5, 0.0)) < 0.30

def process(pdf_bytes):
    try:
        import fitz
    except ImportError:
        sys.exit(1)

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    parts = []
    for page in doc:
        blocks = page.get_text("rawdict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]
        for block in blocks:
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    text = span.get("text", "")
                    color_int = span.get("color", 0)
                    r = ((color_int >> 16) & 0xFF) / 255.0
                    g = ((color_int >> 8) & 0xFF) / 255.0
                    b = (color_int & 0xFF) / 255.0
                    c = (r, g, b)
                    flags = span.get("flags", 0)
                    strikethrough = bool(flags & 8)
                    if is_red(c) or (strikethrough and color_int != 0):
                        parts.append(f"{{--{text}--}}")
                    elif is_blue(c):
                        parts.append(f"{{++{text}++}}")
                    elif is_green(c):
                        parts.append(f"{{<<{text}>>}}")
                    else:
                        parts.append(text)
        parts.append("\n")
    return "".join(parts)

def main():
    pdf_bytes = sys.stdin.buffer.read()
    if not pdf_bytes:
        sys.exit(1)
    result = process(pdf_bytes)
    sys.stdout.write(result)

if __name__ == "__main__":
    main()
