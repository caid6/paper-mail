"""Render pages containing numbered main-figure captions from a scholarly PDF."""
import json
import re
import sys
from pathlib import Path

import fitz

fitz.TOOLS.mupdf_display_errors(False)
fitz.TOOLS.mupdf_display_warnings(False)

CAPTION = re.compile(
    r"^\s*(?P<prefix>supplementary\s+|extended\s+data\s+)?"
    r"(?P<kind>figure|fig(?:ure)?\.?)\s+(?P<number>\d+[a-z]?)\b"
    r"(?P<separator>\s*(?:[|:—–.-]\s*)?)(?P<text>\S.*)?$",
    re.IGNORECASE,
)


def extract(request):
    source = Path(request["file"]).resolve()
    output = Path(request["output_dir"]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    document = fitz.open(source)
    figures = []

    for page_index, page in enumerate(document):
        text_blocks = [block for block in page.get_text("blocks", sort=True) if block[4].strip()]
        context = "\n\n".join(" ".join(block[4].split()) for block in text_blocks)[:16000]
        lines = []
        for block in page.get_text("dict", sort=True)["blocks"]:
            for line in block.get("lines", []):
                text = " ".join(span["text"] for span in line["spans"])
                if text.strip():
                    lines.append(text)
        captions = []
        for line in lines:
            text = " ".join(line.split())
            match = CAPTION.match(text)
            if not match or match.group("prefix"):
                continue
            label = "Figure " + match.group("number")
            captions.append({"label": label, "caption": text})

        for caption_index, caption in enumerate(captions):
            image = output / f"page-{page_index + 1:04d}-figure-{caption_index + 1:03d}.png"
            page.get_pixmap(matrix=fitz.Matrix(2.5, 2.5), alpha=False).save(image)
            figures.append({
                **caption,
                "context": context,
                "alt": caption["caption"],
                "page": page_index + 1,
                "file": image.name,
            })

    return {"figures": figures, "pages": len(document)}


if __name__ == "__main__":
    try:
        result = {"ok": True, **extract(json.load(sys.stdin))}
    except Exception as error:
        result = {"ok": False, "error": str(error)}
    print(json.dumps(result, ensure_ascii=False))
