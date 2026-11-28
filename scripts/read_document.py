"""Validate this paper's PDF and extract every page for grounded reading."""
import json
import sys
from pathlib import Path
from pypdf import PdfReader
from pdf_identity import verify_pdf


def extract_document(file: Path, doi: str, title: str, verify_identity: bool = True) -> dict:
    reader = PdfReader(file)
    checked = verify_pdf(file, file.parent, doi, title) if verify_identity else {
        "pages": len(reader.pages),
        "identity": "unverified",
    }
    if len(reader.pages) > 1000:
        raise ValueError("PDF 超过 1000 页，请上传论文正文文件")
    pages = [{"page": index + 1, "text": page.extract_text() or ""} for index, page in enumerate(reader.pages)]
    metadata = reader.metadata
    return {
        **checked,
        "pages": pages,
        "metadata": {
            "title": str(metadata.title or "").strip() if metadata else "",
            "author": str(metadata.author or "").strip() if metadata else "",
            "subject": str(metadata.subject or "").strip() if metadata else "",
        },
    }


if __name__ == "__main__":
    try:
        request = json.load(sys.stdin)
        result = extract_document(
            Path(request["file"]),
            request.get("doi", ""),
            request.get("title", ""),
            bool(request.get("verify_identity", True)),
        )
        print(json.dumps({"ok": True, **result}, ensure_ascii=False))
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
