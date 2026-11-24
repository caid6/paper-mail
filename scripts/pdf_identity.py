"""Verify PDF structure and exact paper identity without fuzzy matching."""
import unicodedata
from pathlib import Path
from pypdf import PdfReader


def normalized_text(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def verify_pdf(pdf: Path, target: Path, doi: str, title: str) -> dict:
    resolved = pdf.resolve()
    if resolved.parent != target.resolve() or resolved.read_bytes()[:5] != b"%PDF-":
        raise ValueError("文件路径或 PDF 文件头无效")
    reader = PdfReader(resolved)
    if not reader.pages:
        raise ValueError("PDF 没有可读页面")
    first_pages = "\n".join(page.extract_text() or "" for page in list(reader.pages)[:3])
    metadata = reader.metadata
    metadata_title = str(metadata.title or "") if metadata else ""
    metadata_text = "\n".join(str(value) for value in (metadata or {}).values())
    identity_text = normalized_text(first_pages + "\n" + metadata_text)
    exact_doi = "".join(unicodedata.normalize("NFKC", doi).casefold().split())
    exact_title = normalized_text(title).rstrip(".")
    if exact_doi and exact_doi in "".join(identity_text.split()):
        return {"pages": len(reader.pages), "identity": "doi"}
    if exact_title and (
        exact_title == normalized_text(metadata_title).rstrip(".")
        or exact_title in normalized_text(first_pages)
    ):
        return {"pages": len(reader.pages), "identity": "title"}
    raise ValueError("PDF 前三页或元数据未能明确匹配本篇 DOI/标题")
