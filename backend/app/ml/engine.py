"""Redaction engine adapter used by the document routes."""

import re
import tempfile
from pathlib import Path

from pydantic import BaseModel

from app.ml import redact_psudo


DETECTABLE_ENTITY_TYPES = {
    "person_name",
    "company_name",
    "location",
    "date_of_birth",
    "ssn",
    "account_number",
    "credit_card",
    "routing_number",
    "date",
    "email",
    "phone_number",
}

PAGE_MARKER_RE = re.compile(r"--- PAGE (\d+) ---\n?")


class Candidate(BaseModel):
    """One detected PII span. Mirrors the redaction_candidates table."""

    id: str
    entity: str
    text: str
    page: int = 1
    start_offset: int = 0
    end_offset: int = 0
    confidence: float = 0.0
    source: str = "regex"


class Page(BaseModel):
    preview: list[str]
    candidates: list[Candidate]
    text: str = ""
    start_offset: int = 0
    end_offset: int = 0


def _text_from_upload(data: bytes, file_type: str) -> str:
    if file_type == "txt":
        return data.decode("utf-8", errors="replace")

    if file_type == "rtf":
        text = data.decode("utf-8", errors="replace")
        text = re.sub(r"{\\[^{}]+|[{}]", " ", text)
        text = re.sub(r"\\[a-z]+-?\d* ?", " ", text)
        return re.sub(r"\s+\n", "\n", text)

    if file_type == "pdf":
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(data)
            tmp_path = Path(tmp.name)
        try:
            return redact_psudo.read_document_text(tmp_path)
        finally:
            tmp_path.unlink(missing_ok=True)

    if file_type == "docx":
        raise ValueError("DOCX preview/redaction is not connected yet. Please upload PDF, TXT, or RTF.")

    raise ValueError(f"Unsupported file type: {file_type}")


def _page_ranges(text: str) -> list[tuple[int, int, int]]:
    matches = list(PAGE_MARKER_RE.finditer(text))
    if not matches:
        return [(1, 0, len(text))]

    ranges = []
    for idx, match in enumerate(matches):
        page_num = int(match.group(1))
        start = match.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        ranges.append((page_num, start, end))
    return ranges


def _page_for_offset(page_ranges: list[tuple[int, int, int]], offset: int) -> int:
    for page_num, start, end in page_ranges:
        if start <= offset <= end:
            return page_num
    return page_ranges[-1][0] if page_ranges else 1


def _preview_lines(text: str) -> list[str]:
    lines = [line for line in text.strip().splitlines() if line.strip()]
    return lines[:80] or ["No readable text was found on this page."]


def _candidates_from_results(text: str, results, page_ranges) -> list[Candidate]:
    candidates = []
    for idx, result in enumerate(results, start=1):
        if result.entity_type not in DETECTABLE_ENTITY_TYPES:
            continue
        detected_text = text[result.start:result.end]
        if not detected_text.strip():
            continue
        candidates.append(
            Candidate(
                id=f"c{idx}",
                entity=result.entity_type,
                text=detected_text,
                page=_page_for_offset(page_ranges, result.start),
                start_offset=result.start,
                end_offset=result.end,
                confidence=float(result.score or 0),
                source="regex",
            )
        )
    return candidates


def analyze(data: bytes, file_type: str) -> list[Page]:
    """Extract real document text and return detector findings for review."""
    text = _text_from_upload(data, file_type)
    _redacted, results = redact_psudo.redact(text)
    page_ranges = _page_ranges(text)
    candidates = _candidates_from_results(text, results, page_ranges)

    pages = []
    for page_num, start, end in page_ranges:
        page_text = text[start:end]
        pages.append(
            Page(
                preview=_preview_lines(page_text),
                candidates=[c for c in candidates if c.page == page_num],
                text=page_text,
                start_offset=start,
                end_offset=end,
            )
        )
    return pages or [Page(preview=["No readable text was found."], candidates=[])]


def apply(data: bytes, file_type: str, accepted: list[Candidate]) -> bytes:
    """Apply accepted redactions to the stored artifact."""
    if file_type == "pdf":
        return _redact_pdf(data, accepted)

    text = _text_from_upload(data, file_type)
    return _redact_text(text, accepted).encode("utf-8")


def _redact_text(text: str, accepted: list[Candidate]) -> str:
    redacted = text
    for candidate in sorted(accepted, key=lambda c: c.start_offset, reverse=True):
        label = f"<{candidate.entity}>"
        redacted = redacted[:candidate.start_offset] + label + redacted[candidate.end_offset:]
    return redacted


def _redact_pdf(data: bytes, accepted: list[Candidate]) -> bytes:
    import pymupdf

    document = pymupdf.open(stream=data, filetype="pdf")
    try:
        for candidate in accepted:
            for page in document:
                for rect in page.search_for(candidate.text):
                    page.add_redact_annot(rect, text=f"<{candidate.entity}>")
        for page in document:
            page.apply_redactions()
        return document.tobytes()
    finally:
        document.close()
