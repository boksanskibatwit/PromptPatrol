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
# ENTITY MAP (normalize everything early)
# =========================
ENTITY_MAP = {
    "PERSON": "PERSON",
    "EMAIL_ADDRESS": "EMAIL",
    "PHONE_NUMBER": "PHONE",
    "CREDIT_CARD": "CREDIT_CARD",
    "SSN": "SSN",
    "US_SSN": "SSN",
    "DATE_OF_BIRTH": "DOB",
    "DATE_TIME": "DATE",
    "LOCATION": "LOCATION",
    "ORGANIZATION": "ORG",
    "US_BANK_NUMBER": "ROUTING"
}

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
        Pattern("ssn", r"\b\d{3}-\d{2}-\d{4}\b", 0.95)
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
# PHONE (strict format)
# =========================
phone_recognizer = PatternRecognizer(
    supported_entity="PHONE_NUMBER",
    patterns=[
        Pattern("phone", r"\b\d{3}-\d{3}-\d{4}\b", 0.9)
    ],
)
analyzer.registry.add_recognizer(phone_recognizer)


# =========================
# ROUTING NUMBER
# =========================
routing_recognizer = PatternRecognizer(
    supported_entity="US_BANK_NUMBER",
    patterns=[
        Pattern("routing", r"\b\d{9}\b", 0.6)
    ],
)
analyzer.registry.add_recognizer(routing_recognizer)


# =========================
# DOB extraction
# =========================
DOB_REGEX = re.compile(
    r"(?:0?[1-9]|1[0-2])[/-](?:0?[1-9]|[12]\d|3[01])[/-](?:19|20)\d{2}"
)

def find_dobs(text):
    return [
        RecognizerResult(
            entity_type="DATE_OF_BIRTH",
            start=m.start(),
            end=m.end(),
            score=0.9
        )
        for m in DOB_REGEX.finditer(text)
    ]


# =========================
# VALIDATION HELPERS
# =========================

def is_valid_date_span(text, start, end):
    span = text[start:end]
    return len(span) <= 10 and not re.search(r"\d{4,}", span)


def is_phone_span(text, start, end):
    span = text[start:end]
    return bool(re.fullmatch(r"\d{3}-\d{3}-\d{4}", span))


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
    results = sorted(
        results,
        key=lambda x: (x.start, -(x.end - x.start), -x.score)
    )

    filtered = []
    last_end = -1

    for r in results:
        if r.start >= last_end:
            filtered.append(r)
            last_end = r.end

    return filtered


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

    results = analyzer.analyze(text=text, language="en")
    results.extend(find_dobs(text))

    # normalize entities
    for r in results:
        r.entity_type = ENTITY_MAP.get(r.entity_type, r.entity_type)
        

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
            r.entity_type in ["DATE", "DATE_OF_BIRTH"]
            and not is_valid_date_span(text, r.start, r.end)
        )
    ]

    # ensure phone correctness
    results = [
        r for r in results
        if not (
            r.entity_type == "PHONE_NUMBER"
            and not is_phone_span(text, r.start, r.end)
        )
    ]

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
    run("testpdf1.pdf", "redacted_output1.txt")