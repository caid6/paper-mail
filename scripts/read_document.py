"""Validate this paper's PDF and extract every page for grounded reading."""
import json
import sys
from pathlib import Path
from pypdf import PdfReader
from pdf_identity import verify_pdf


def extract_document(file: Path, doi: str, title: str) -> dict:
    checked = verify_pdf(file, file.parent, doi, title)
    reader = PdfReader(file)
    if len(reader.pages) > 1000:
        raise ValueError("PDF 超过 1000 页，请上传论文正文文件")
    pages = [{"page": index + 1, "text": page.extract_text() or ""} for index, page in enumerate(reader.pages)]
    return {**checked, "pages": pages}


if __name__ == "__main__":
    try:
        request = json.load(sys.stdin)
        result = extract_document(Path(request["file"]), request.get("doi", ""), request["title"])
        print(json.dumps({"ok": True, **result}, ensure_ascii=False))
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
