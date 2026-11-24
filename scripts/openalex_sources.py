"""Select only DOI-matched, explicitly open-access locations from OpenAlex."""
from urllib.parse import urlparse


def normalize_doi(value: str) -> str:
    normalized = value.strip().casefold()
    for prefix in ("https://doi.org/", "http://doi.org/", "doi:"):
        if normalized.startswith(prefix):
            normalized = normalized[len(prefix):]
            break
    return normalized.strip()


def matches_doi(work: dict, doi: str) -> bool:
    return normalize_doi(str(work.get("doi") or "")) == normalize_doi(doi)


def candidate_urls(work: dict, doi: str) -> list[str]:
    if not matches_doi(work, doi):
        raise ValueError("OpenAlex 返回的 DOI 与论文记录不一致")
    urls: list[str] = []
    seen: set[str] = set()
    for key in ("pdf_url", "landing_page_url"):
        for location in work.get("locations") or []:
            if location.get("is_oa") is not True:
                continue
            url = location.get(key)
            parsed = urlparse(url or "")
            if parsed.scheme not in {"http", "https"} or not parsed.netloc or url in seen:
                continue
            seen.add(url)
            urls.append(url)
    return urls
