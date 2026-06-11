"""
Redaction engine seam.

The real spaCy/regex pipeline (redact_text.py) is being built separately. Until
it lands, `analyze` returns the same placeholder pages the frontend used to
hard-code, and `apply` stores the file unmodified. When the pipeline is ready,
replace the bodies of `analyze` and `apply` — every route, DB row, and frontend
call already flows through this module, so nothing else changes.

Contract:
  analyze(data, file_type) -> list[Page]   findings for the review screen
  apply(data, file_type, accepted) -> bytes  the redacted artifact to store
"""

from pydantic import BaseModel


class Candidate(BaseModel):
    """One detected PII span. Mirrors the redaction_candidates table."""

    id: str
    entity: str  # entity_type_t value
    text: str  # matched_text
    page: int = 1
    start_offset: int = 0
    end_offset: int = 0
    confidence: float = 0.0
    source: str = "regex"  # detection_source_t value


class Page(BaseModel):
    preview: list[str]
    candidates: list[Candidate]


_PLACEHOLDER_PAGES = [
    Page(
        preview=[
            "Loan Application reviewed for applicant",
            "Collin J. Lane, residing at",
            "550 Huntington Ave, Boston, MA",
            "Date of Birth:        11/22/2003",
            "SSN: *** **** 2022",
            "Annual Reported Income: $100,000,000",
            "Account Number: 427498 - 234824",
        ],
        candidates=[
            Candidate(id="p1-1", entity="person_name", text="Collin J. Lane", page=1),
            Candidate(id="p1-2", entity="location", text="550 Huntington Ave", page=1),
            Candidate(id="p1-3", entity="date_of_birth", text="11/22/2003", page=1),
            Candidate(id="p1-4", entity="ssn", text="**** **** 2022", page=1),
            Candidate(id="p1-5", entity="account_number", text="427498 - 234824", page=1),
        ],
    ),
    Page(
        preview=[
            "Co-applicant details",
            "Jane A. Doe, residing at",
            "12 Beacon Street, Boston, MA",
            "Date of Birth:        04/02/1999",
            "SSN: *** **** 8841",
        ],
        candidates=[
            Candidate(id="p2-1", entity="person_name", text="Jane A. Doe", page=2),
            Candidate(id="p2-2", entity="location", text="12 Beacon Street", page=2),
            Candidate(id="p2-3", entity="date_of_birth", text="04/02/1999", page=2),
            Candidate(id="p2-4", entity="ssn", text="**** **** 8841", page=2),
        ],
    ),
    Page(
        preview=[
            "Employment verification",
            "Employer: Acme Financial Group",
            "Contact: hr@acmefinancial.com",
            "Routing Number: 011000015",
        ],
        candidates=[
            Candidate(id="p3-1", entity="company_name", text="Acme Financial Group", page=3),
            Candidate(id="p3-2", entity="routing_number", text="011000015", page=3),
        ],
    ),
    Page(
        preview=[
            "Signatures",
            "Signed on 05/14/2026 by Collin J. Lane",
            "Card on file: 4242 4242 4242 4242",
        ],
        candidates=[
            Candidate(id="p4-1", entity="date", text="05/14/2026", page=4),
            Candidate(id="p4-2", entity="person_name", text="Collin J. Lane", page=4),
            Candidate(id="p4-3", entity="credit_card", text="4242 4242 4242 4242", page=4),
        ],
    ),
]


def analyze(data: bytes, file_type: str) -> list[Page]:
    """STUB — returns placeholder findings regardless of the file contents."""
    return _PLACEHOLDER_PAGES


def apply(data: bytes, file_type: str, accepted: list[Candidate]) -> bytes:
    """STUB — pass-through. The stored artifact is NOT actually redacted yet."""
    return data
