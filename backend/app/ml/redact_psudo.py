from presidio_analyzer import AnalyzerEngine, PatternRecognizer, Pattern
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import RecognizerResult
import re
from functools import lru_cache
from io import BytesIO
from pathlib import Path

import easyocr
import numpy as np
import pymupdf
from PIL import Image

# =========================
# INIT
# =========================
analyzer = AnalyzerEngine()
anonymizer = AnonymizerEngine()

# =========================
# ENTITY MAP (normalize to app entity_type_t values)
# =========================
ENTITY_MAP = {
    "PERSON": "person_name",
    "ORGANIZATION": "company_name",
    "LOCATION": "location",
    "DATE_OF_BIRTH": "date_of_birth",
    "SSN": "ssn",
    "US_SSN": "ssn",
    "EMAIL_ADDRESS": "email",
    "PHONE_NUMBER": "phone_number",
    "CREDIT_CARD": "credit_card",
    "US_BANK_NUMBER": "routing_number",
    "US_ACCOUNT_NUMBER": "account_number",
    "DATE_TIME": "date",
}

ALLOWED_ENTITY_TYPES = set(ENTITY_MAP.values())
PRESIDIO_ENTITY_TYPES = tuple(
    entity_type
    for entity_type in ENTITY_MAP
    if entity_type not in {"US_BANK_NUMBER", "US_ACCOUNT_NUMBER", "US_SSN"}
)

# =========================
# LUHN CHECK (credit card validation)
# =========================
def luhn_check(number: str) -> bool:
    digits = [int(d) for d in number if d.isdigit()]
    checksum = 0
    parity = len(digits) % 2

    for i, digit in enumerate(digits):
        if i % 2 == parity:
            digit *= 2
            if digit > 9:
                digit -= 9
        checksum += digit

    return checksum % 10 == 0


# =========================
# SSN
# =========================
ssn_recognizer = PatternRecognizer(
    supported_entity="SSN",
    patterns=[
        Pattern("ssn", r"(?<![A-Za-z0-9])\d{3}-\d{2}-\d{4}(?![A-Za-z0-9])", 0.95)
    ],
)
analyzer.registry.add_recognizer(ssn_recognizer)


# =========================
# CREDIT CARD (format only)
# =========================
cc_recognizer = PatternRecognizer(
    supported_entity="CREDIT_CARD",
    patterns=[
        Pattern(
            "cc",
            r"\b(?:4\d{12}(?:\d{3})?|5[1-5]\d{14}|3[47]\d{13})\b",
            0.9
        )
    ],
)
analyzer.registry.add_recognizer(cc_recognizer)


# =========================
# ROUTING NUMBER
# =========================
# Routing numbers are added by a context-aware regex pass below. Presidio's
# generic 9-digit recognizer is too noisy for bank statements and fixtures.


# Account numbers are also added by a regex pass so the detected span is only
# the sensitive value, not the "Account Number:" label.


# =========================
# DOB extraction
# =========================
DOB_REGEX = re.compile(
    r"(?:0?[1-9]|1[0-2])[/-](?:0?[1-9]|[12]\d|3[01])[/-](?:19|20)\d{2}"
)
MONTH_DATE_REGEX = re.compile(
    r"\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
    r"Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|"
    r"Dec(?:ember)?)\s+\d{1,2},\s+(?:19|20)\d{2}\b",
    re.IGNORECASE,
)
SHORT_MONTH_DAY_REGEX = re.compile(
    r"(?<![\d-])(?:0?[1-9]|1[0-2])-(?:0?[1-9]|[12]\d|3[01])(?![\d-])"
)
EMAIL_REGEX = re.compile(
    r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b",
    re.IGNORECASE,
)
PHONE_REGEX = re.compile(
    r"(?<!\d)(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)"
)
ACCOUNT_REGEX = re.compile(
    r"\b(?:account(?:\s+number)?|acct\.?|a/c)\s*#?\s*[:\-]?\s*(\d[\d\s-]{4,}\d)\b",
    re.IGNORECASE,
)
ROUTING_REGEX = re.compile(
    r"\b(?:routing(?:\s+number)?|aba)\s*#?\s*[:\-]?\s*(\d{9})\b",
    re.IGNORECASE,
)
COMPANY_REGEX = re.compile(
    r"\b(?:employer|company|organization|business|client|vendor)\s*[:\-]\s*"
    r"([A-Z][A-Za-z0-9&.,'-]*(?:[ \t]+[A-Z][A-Za-z0-9&.,'-]*){1,5})\b"
)
COMPANY_SUFFIX_REGEX = re.compile(
    r"\b[A-Z][A-Za-z0-9&.'-]*(?:[ \t]+[A-Z][A-Za-z0-9&.'-]*){0,4}"
    r"[ \t]+(?:Bank|Capital|Company|Corp|Corporation|Credit Union|Financial|Group|Holdings|"
    r"Insurance|Investments|Labs|LLC|Ltd|Partners|Research|Technologies|University)\b"
)
COMPANY_CONTEXT_REGEX = re.compile(
    r"\b(?:at|for|from|employed by|worked at|previously worked at)\s+"
    r"([A-Z][A-Za-z0-9&.'-]*(?:[ \t]+(?:and[ \t]+)?[A-Z][A-Za-z0-9&.'-]*){0,5})\b"
)
ADDRESS_REGEX = re.compile(
    r"\b\d{1,6}\s+[A-Z][A-Za-z0-9.'-]*(?:\s+[A-Z][A-Za-z0-9.'-]*){1,5},\s*"
    r"[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*)?,\s*[A-Z]{2}\b"
)
MULTILINE_ADDRESS_REGEX = re.compile(
    r"\b\d{1,6}\s+[A-Z][A-Za-z0-9.'-]*(?:[ \t]+[A-Z][A-Za-z0-9.'-]*){0,5}\.?"
    r"\s*\n\s*[A-Z][A-Za-z.'-]*(?:[ \t]+[A-Z][A-Za-z.'-]*)?,?\s+[A-Z]{2}"
    r"(?:\s+\d{5}(?:-\d{4})?)?\b"
)
NAME_BEFORE_ADDRESS_REGEX = re.compile(
    r"\n\s*([A-Z][a-z]+(?:[ \t]+[A-Z]\.)?[ \t]+[A-Z][a-z]+)\s*\n"
    r"\s*\d{1,6}\s+[A-Z]"
)


def result_from_match(entity_type, match, score=0.9, group=0):
    return RecognizerResult(
        entity_type=entity_type,
        start=match.start(group),
        end=match.end(group),
        score=score,
    )


def has_birth_context(text, start, end):
    window = text[max(0, start - 35):min(len(text), end + 10)].lower()
    return (
        "date of birth" in window
        or "dob" in window
        or "birth date" in window
    )

def find_dobs(text):
    return [
        result_from_match("DATE_OF_BIRTH", m, 1.0)
        for m in DOB_REGEX.finditer(text)
        if has_birth_context(text, m.start(), m.end())
    ]


def find_dates(text):
    dates = [
        result_from_match("DATE_TIME", m, 0.8)
        for m in DOB_REGEX.finditer(text)
        if not has_birth_context(text, m.start(), m.end())
    ]
    dates.extend(
        result_from_match("DATE_TIME", m, 0.82)
        for m in MONTH_DATE_REGEX.finditer(text)
        if not has_birth_context(text, m.start(), m.end())
    )
    dates.extend(
        result_from_match("DATE_TIME", m, 0.78)
        for m in SHORT_MONTH_DAY_REGEX.finditer(text)
    )
    return dates


def find_emails(text):
    return [
        result_from_match("EMAIL_ADDRESS", m, 0.95)
        for m in EMAIL_REGEX.finditer(text)
    ]


def find_phone_numbers(text):
    return [
        result_from_match("PHONE_NUMBER", m, 0.9)
        for m in PHONE_REGEX.finditer(text)
    ]


def find_account_numbers(text):
    return [
        result_from_match("US_ACCOUNT_NUMBER", m, 0.94, group=1)
        for m in ACCOUNT_REGEX.finditer(text)
    ]


def find_routing_numbers(text):
    return [
        result_from_match("US_BANK_NUMBER", m, 0.9, group=1)
        for m in ROUTING_REGEX.finditer(text)
    ]


def find_companies(text):
    companies = [
        result_from_match("ORGANIZATION", m, 0.85, group=1)
        for m in COMPANY_REGEX.finditer(text)
    ]
    companies.extend(
        result_from_match("ORGANIZATION", m, 0.82)
        for m in COMPANY_SUFFIX_REGEX.finditer(text)
    )

    for m in COMPANY_CONTEXT_REGEX.finditer(text):
        value_start = m.start(1)
        value = m.group(1).rstrip(".,")
        parts = re.finditer(
            r"[A-Z][A-Za-z0-9&.'-]*(?:[ \t]+[A-Z][A-Za-z0-9&.'-]*)*",
            value.replace(" and ", "\n"),
        )
        search_offset = 0
        for part in parts:
            name = part.group(0)
            original_start = text.find(name, value_start + search_offset)
            if original_start == -1:
                continue
            search_offset = original_start - value_start + len(name)
            companies.append(
                RecognizerResult(
                    entity_type="ORGANIZATION",
                    start=original_start,
                    end=original_start + len(name),
                    score=0.78,
                )
            )

    return companies


def find_addresses(text):
    addresses = [
        result_from_match("LOCATION", m, 0.98)
        for m in ADDRESS_REGEX.finditer(text)
    ]
    addresses.extend(
        result_from_match("LOCATION", m, 0.98)
        for m in MULTILINE_ADDRESS_REGEX.finditer(text)
    )
    return addresses


def find_names_before_addresses(text):
    return [
        result_from_match("PERSON", m, 0.86, group=1)
        for m in NAME_BEFORE_ADDRESS_REGEX.finditer(text)
    ]


# =========================
# VALIDATION HELPERS
# =========================

def is_valid_date_span(text, start, end):
    span = text[start:end]
    return bool(
        re.fullmatch(
            r"(?:0?[1-9]|1[0-2])[/-](?:0?[1-9]|[12]\d|3[01])[/-](?:19|20)\d{2}",
            span,
        )
        or MONTH_DATE_REGEX.fullmatch(span)
        or SHORT_MONTH_DAY_REGEX.fullmatch(span)
    )


def is_routing_context(text, start, end):
    window = text[max(0, start-20):min(len(text), end+20)].lower()
    return "routing" in window or "aba" in window




# =========================
# CREDIT CARD VALIDATION
# =========================
def filter_credit_cards(text, results):
    filtered = []

    for r in results:
        if r.entity_type == "CREDIT_CARD":
            value = text[r.start:r.end].replace(" ", "").replace("-", "")
            if 13 <= len(value) <= 19 and luhn_check(value):
                filtered.append(r)
        else:
            filtered.append(r)

    return filtered

# =========================
# OCR PDF EXTRACTION
# =========================
@lru_cache(maxsize=1)
def get_ocr_reader() -> easyocr.Reader:
    """
    Load the EasyOCR model once and reuse it for every PDF page.
    """
    model_directory = Path(__file__).resolve().parent / "ocr_models"
    model_directory.mkdir(parents=True, exist_ok=True)

    return easyocr.Reader(
        ["en"],
        gpu=False,
        model_storage_directory=str(model_directory),
        download_enabled=True,
    )


def ocr_pdf_page(
    page: pymupdf.Page,
    dpi: int = 300,
) -> str:
    """
    Render one PDF page as an image and perform OCR using EasyOCR.
    """
    pixmap = page.get_pixmap(
        dpi=dpi,
        colorspace=pymupdf.csRGB,
        alpha=False,
    )

    image_bytes = pixmap.tobytes("png")

    with Image.open(BytesIO(image_bytes)) as image:
        image_array = np.array(image.convert("RGB"))

    reader = get_ocr_reader()

    detected_lines = reader.readtext(
        image_array,
        detail=0,
        paragraph=True,
        rotation_info=[90, 180, 270],
    )

    return "\n".join(detected_lines).strip()

def has_meaningful_text(
    text: str,
    minimum_characters: int = 20,
) -> bool:
    alphanumeric_count = sum(
        character.isalnum()
        for character in text
    )

    return alphanumeric_count >= minimum_characters


def read_pdf_text(
    input_file: Path,
    ocr_dpi: int = 300,
) -> str:
    extracted_pages = []

    try:
        document = pymupdf.open(input_file)
    except Exception as error:
        raise ValueError(
            f"Unable to open PDF: {input_file}"
        ) from error

    try:
        if document.needs_pass:
            raise ValueError(
                f"The PDF is password protected: {input_file}"
            )

        for page_number, page in enumerate(document, start=1):
            native_text = page.get_text(
                "text",
                sort=True,
            ).strip()

            if has_meaningful_text(native_text):
                page_text = native_text
                extraction_method = "embedded text"
            else:
                print(
                    f"Page {page_number}: running EasyOCR..."
                )

                page_text = ocr_pdf_page(
                    page=page,
                    dpi=ocr_dpi,
                )

                extraction_method = "EasyOCR"

            if not page_text:
                print(
                    f"Warning: no text was found on page "
                    f"{page_number}."
                )

            print(
                f"Page {page_number}: extracted using "
                f"{extraction_method}."
            )

            extracted_pages.append(
                f"--- PAGE {page_number} ---\n{page_text}"
            )

    finally:
        document.close()

    return "\n\n".join(extracted_pages)

# =========================
# OVERLAP RESOLVER
# =========================
def resolve_overlaps(results):
    entity_priority = {
        "DATE_OF_BIRTH": 0,
        "LOCATION": 1,
        "ORGANIZATION": 2,
        "EMAIL_ADDRESS": 3,
        "US_ACCOUNT_NUMBER": 4,
        "PHONE_NUMBER": 5,
        "US_BANK_NUMBER": 6,
        "CREDIT_CARD": 7,
        "SSN": 8,
        "US_SSN": 8,
        "PERSON": 9,
        "DATE_TIME": 10,
    }

    results = sorted(
        results,
        key=lambda x: (
            -x.score,
            entity_priority.get(x.entity_type, 99),
            -(x.end - x.start),
            x.start,
        )
    )

    filtered = []

    for r in results:
        overlaps_existing = any(
            r.start < existing.end and existing.start < r.end
            for existing in filtered
        )
        if not overlaps_existing:
            filtered.append(r)

    return sorted(filtered, key=lambda x: x.start)


# =========================
# DOCUMENT READER
# =========================
SUPPORTED_INPUT_TYPES = {".txt", ".pdf"}


def read_document_text(input_file: str | Path) -> str:
    """
    Read text from either a TXT file or a PDF.

    PDFs with embedded text use normal extraction.
    Scanned PDF pages are automatically sent through EasyOCR
    by read_pdf_text().
    """
    input_path = Path(input_file)

    if not input_path.exists():
        raise FileNotFoundError(
            f"Input file does not exist: {input_path}"
        )

    if not input_path.is_file():
        raise ValueError(
            f"Input path is not a file: {input_path}"
        )

    extension = input_path.suffix.lower()

    if extension not in SUPPORTED_INPUT_TYPES:
        raise ValueError(
            f"Unsupported file type: {extension}\n"
            f"Supported file types: "
            f"{', '.join(sorted(SUPPORTED_INPUT_TYPES))}"
        )

    if extension == ".txt":
        return input_path.read_text(
            encoding="utf-8",
            errors="replace",
        )

    if extension == ".pdf":
        return read_pdf_text(input_path)

    raise ValueError(
        f"Unable to process file type: {extension}"
    )

# =========================
# MAIN PIPELINE
# =========================
def redact(text: str):

    results = analyzer.analyze(
        text=text,
        language="en",
        entities=PRESIDIO_ENTITY_TYPES,
    )
    results.extend(find_dobs(text))
    results.extend(find_dates(text))
    results.extend(find_emails(text))
    results.extend(find_phone_numbers(text))
    results.extend(find_account_numbers(text))
    results.extend(find_routing_numbers(text))
    results.extend(find_companies(text))
    results.extend(find_addresses(text))
    results.extend(find_names_before_addresses(text))

    # validate credit cards (Luhn)
    results = filter_credit_cards(text, results)

    # remove routing unless context matches
    results = [
        r for r in results
        if not (
            r.entity_type == "US_BANK_NUMBER"
            and not is_routing_context(text, r.start, r.end)
        )
    ]

    # clean invalid DOB/DATE noise
    results = [
        r for r in results
        if not (
            r.entity_type in ["DATE_TIME", "DATE_OF_BIRTH"]
            and not is_valid_date_span(text, r.start, r.end)
        )
    ]

    # Normalize to the app enum values used by Redact.jsx / Supabase, and
    # discard Presidio entities outside the supported redaction label set.
    normalized_results = []
    for r in results:
        mapped_entity = ENTITY_MAP.get(r.entity_type)
        if mapped_entity in ALLOWED_ENTITY_TYPES:
            r.entity_type = mapped_entity
            normalized_results.append(r)
    results = normalized_results

    # final cleanup
    results = resolve_overlaps(results)

    redacted = anonymizer.anonymize(
        text=text,
        analyzer_results=results
    )

    return redacted.text, results


# =========================
# FILE RUNNER
# =========================
def run(
    input_file: str | Path,
    output_file: str | Path,
) -> None:
    input_path = Path(input_file)
    output_path = Path(output_file)

    # Prevent accidentally overwriting the original file.
    if input_path.resolve() == output_path.resolve():
        raise ValueError(
            "The input and output files cannot be the same."
        )

    # This program currently outputs extracted/redacted text,
    # not a visually redacted PDF.
    if output_path.suffix.lower() != ".txt":
        raise ValueError(
            "The output file must currently be a .txt file.\n"
            "Example: redacted_output.txt"
        )

    print(f"Reading: {input_path}")

    text = read_document_text(input_path)

    if not text.strip():
        raise ValueError(
            "No readable text was found in the input document."
        )

    print("Analyzing document for PII...")

    redacted, findings = redact(text)

    # Create the output directory if it does not exist.
    output_path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    output_path.write_text(
        redacted,
        encoding="utf-8",
    )

    print("\n=== FINDINGS ===")

    if not findings:
        print("No PII was detected.")
    else:
        # Sort findings so they print in document order.
        sorted_findings = sorted(
            findings,
            key=lambda finding: finding.start,
        )

        for finding in sorted_findings:
            detected_text = text[
                finding.start:finding.end
            ]

            print(
                f"{finding.entity_type} -> "
                f"{detected_text}"
            )

    print(f"\nTotal findings: {len(findings)}")
    print(f"Saved: {output_path}")



# =========================
# ENTRY
# =========================
if __name__ == "__main__":
    run("Testfiles/testfile.txt", "Testfiles/redacted_txt1.txt")
    run("Testfiles/testfile2.txt", "Testfiles/redacted_txt2.txt")   
    run("Testfiles/testpdf1.pdf", "Testfiles/redacted_txt3.txt")
