#!/usr/bin/env python3

import argparse
import io
import json
import re
from pathlib import Path

import fitz  # PyMuPDF
from PIL import Image
import pytesseract

# Need "python -m pip install pymupdf pillow pytesseract"
# How to run python scan_pdf_pii.py document.pdf
# Use -o for JSON output

# Optional Windows Tesseract path.
# Uncomment this line if Python cannot find Tesseract:
# pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"


# =========================
# Regex Patterns
# =========================

SSN_PATTERNS = [
    re.compile(
        r"(?<!\d)(?!000|666|9\d{2})(\d{3})[-\s](?!00)(\d{2})[-\s](?!0000)(\d{4})(?!\d)"
    ),
    re.compile(
        r"(?i)\b(?:ssn|social\s+security(?:\s+number)?)\b[\s:#-]{0,25}"
        r"((?!000|666|9\d{2})\d{3}[-\s]?(?!00)\d{2}[-\s]?(?!0000)\d{4})\b"
    ),
]

CREDIT_CARD_PATTERN = re.compile(
    r"(?<!\d)(?:\d[ -]*?){13,19}(?!\d)"
)

ROUTING_PATTERN = re.compile(
    r"(?i)\b(?:routing(?:\s+number)?|aba|rtn)\b[\s:#-]{0,25}(\d{9})\b"
)

BANK_ACCOUNT_PATTERN = re.compile(
    r"(?i)\b(?:account(?:\s+number)?|acct(?:\.|#)?|bank\s+account)\b[\s:#-]{0,25}"
    r"([A-Z0-9][A-Z0-9\-]{3,23})\b"
)

DOB_PATTERN = re.compile(
    r"(?i)\b(?:date\s+of\s+birth|dob|birth\s+date|born)\b[\s:#-]{0,25}"
    r"("
    r"(?:0?[1-9]|1[0-2])[/-](?:0?[1-9]|[12]\d|3[01])[/-](?:19|20)\d{2}"
    r"|"
    r"(?:19|20)\d{2}[/-](?:0?[1-9]|1[0-2])[/-](?:0?[1-9]|[12]\d|3[01])"
    r")"
)


# =========================
# Validation Helpers
# =========================

def luhn_check(number: str) -> bool:
    """
    Validate credit card number using the Luhn algorithm.
    This reduces false positives from random long numbers.
    """
    digits = [int(d) for d in number if d.isdigit()]

    if not 13 <= len(digits) <= 19:
        return False

    if len(set(digits)) == 1:
        return False

    checksum = 0
    parity = len(digits) % 2

    for i, digit in enumerate(digits):
        if i % 2 == parity:
            digit *= 2
            if digit > 9:
                digit -= 9
        checksum += digit

    return checksum % 10 == 0


def aba_routing_check(routing_number: str) -> bool:
    """
    Validate a 9-digit ABA routing number.
    """
    if not re.fullmatch(r"\d{9}", routing_number):
        return False

    digits = [int(d) for d in routing_number]

    checksum = (
        3 * (digits[0] + digits[3] + digits[6])
        + 7 * (digits[1] + digits[4] + digits[7])
        + 1 * (digits[2] + digits[5] + digits[8])
    )

    return checksum % 10 == 0


# =========================
# Masking Helpers
# =========================

def mask_ssn(value: str) -> str:
    digits = re.sub(r"\D", "", value)
    return f"***-**-{digits[-4:]}"


def mask_credit_card(value: str) -> str:
    digits = re.sub(r"\D", "", value)
    return f"{digits[:4]} **** **** {digits[-4:]}"


def mask_bank_account(value: str) -> str:
    clean = re.sub(r"[^A-Za-z0-9]", "", value)

    if len(clean) <= 4:
        return "*" * len(clean)

    return "*" * (len(clean) - 4) + clean[-4:]


def mask_routing(value: str) -> str:
    return f"*****{value[-4:]}"


def mask_dob(value: str) -> str:
    return "**/**/****"


def get_snippet(text: str, start: int, end: int, window: int = 60) -> str:
    left = max(start - window, 0)
    right = min(end + window, len(text))
    snippet = text[left:right]
    return " ".join(snippet.split())


# =========================
# OCR + PDF Text Extraction
# =========================

def ocr_page(page, dpi: int = 300) -> str:
    """
    Render a PDF page as an image and OCR it.
    Used for scanned/image-based pages.
    """
    zoom = dpi / 72
    matrix = fitz.Matrix(zoom, zoom)

    pix = page.get_pixmap(matrix=matrix, alpha=False)
    image_bytes = pix.tobytes("png")

    image = Image.open(io.BytesIO(image_bytes))

    text = pytesseract.image_to_string(image)

    return text


def extract_text_from_pdf(
    pdf_path: Path,
    use_ocr: bool = True,
    ocr_threshold: int = 30,
    dpi: int = 300
) -> list[dict]:
    """
    Extract text from each PDF page.

    First, it attempts normal embedded-text extraction.
    If the page has little or no text, it falls back to OCR.
    """
    pages = []

    with fitz.open(pdf_path) as doc:
        for page_number, page in enumerate(doc, start=1):
            embedded_text = page.get_text("text").strip()
            final_text = embedded_text
            extraction_method = "embedded_text"
            ocr_error = None

            if use_ocr and len(embedded_text) < ocr_threshold:
                try:
                    ocr_text = ocr_page(page, dpi=dpi).strip()

                    if len(ocr_text) > len(embedded_text):
                        final_text = ocr_text
                        extraction_method = "ocr"

                except Exception as error:
                    ocr_error = str(error)
                    extraction_method = "embedded_text_ocr_failed"

            pages.append({
                "page": page_number,
                "text": final_text,
                "extraction_method": extraction_method,
                "ocr_error": ocr_error
            })

    return pages


# =========================
# PII Scanning
# =========================

def add_finding(
    findings: list,
    pii_type: str,
    raw_value: str,
    masked_value: str,
    page: int,
    start: int,
    end: int,
    text: str,
    extraction_method: str
):
    findings.append({
        "type": pii_type,
        "page": page,
        "masked_value": masked_value,
        "extraction_method": extraction_method,
        "snippet": get_snippet(text, start, end)
    })


def scan_text_for_pii(
    page_text: str,
    page_number: int,
    extraction_method: str
) -> list[dict]:
    findings = []
    seen = set()

    # SSN
    for pattern in SSN_PATTERNS:
        for match in pattern.finditer(page_text):
            raw = match.group(0)

            if match.lastindex:
                raw = match.group(match.lastindex)

            digits = re.sub(r"\D", "", raw)
            key = ("SSN", digits, page_number)

            if key not in seen:
                seen.add(key)
                add_finding(
                    findings,
                    "SSN",
                    raw,
                    mask_ssn(raw),
                    page_number,
                    match.start(),
                    match.end(),
                    page_text,
                    extraction_method
                )

    # Credit Card
    for match in CREDIT_CARD_PATTERN.finditer(page_text):
        raw = match.group(0)
        digits = re.sub(r"\D", "", raw)

        if luhn_check(digits):
            key = ("Credit Card", digits, page_number)

            if key not in seen:
                seen.add(key)
                add_finding(
                    findings,
                    "Credit Card",
                    raw,
                    mask_credit_card(raw),
                    page_number,
                    match.start(),
                    match.end(),
                    page_text,
                    extraction_method
                )

    # Bank Routing Number
    for match in ROUTING_PATTERN.finditer(page_text):
        raw = match.group(1)

        if aba_routing_check(raw):
            key = ("Bank Routing Number", raw, page_number)

            if key not in seen:
                seen.add(key)
                add_finding(
                    findings,
                    "Bank Routing Number",
                    raw,
                    mask_routing(raw),
                    page_number,
                    match.start(),
                    match.end(),
                    page_text,
                    extraction_method
                )

    # Bank Account Number
    for match in BANK_ACCOUNT_PATTERN.finditer(page_text):
        raw = match.group(1)

        # Avoid flagging valid routing numbers as account numbers.
        if raw.isdigit() and len(raw) == 9 and aba_routing_check(raw):
            continue

        key = ("Bank Account", raw, page_number)

        if key not in seen:
            seen.add(key)
            add_finding(
                findings,
                "Bank Account",
                raw,
                mask_bank_account(raw),
                page_number,
                match.start(),
                match.end(),
                page_text,
                extraction_method
            )

    # Date of Birth
    for match in DOB_PATTERN.finditer(page_text):
        raw = match.group(1)
        key = ("Date of Birth", raw, page_number)

        if key not in seen:
            seen.add(key)
            add_finding(
                findings,
                "Date of Birth",
                raw,
                mask_dob(raw),
                page_number,
                match.start(),
                match.end(),
                page_text,
                extraction_method
            )

    return findings


def scan_pdf(
    pdf_path: Path,
    use_ocr: bool = True,
    ocr_threshold: int = 30,
    dpi: int = 300
) -> dict:
    pages = extract_text_from_pdf(
        pdf_path=pdf_path,
        use_ocr=use_ocr,
        ocr_threshold=ocr_threshold,
        dpi=dpi
    )

    all_findings = []
    page_methods = []

    for page in pages:
        page_number = page["page"]
        page_text = page["text"]
        extraction_method = page["extraction_method"]

        page_methods.append({
            "page": page_number,
            "extraction_method": extraction_method,
            "ocr_error": page["ocr_error"]
        })

        page_findings = scan_text_for_pii(
            page_text=page_text,
            page_number=page_number,
            extraction_method=extraction_method
        )

        all_findings.extend(page_findings)

    summary = {}

    for finding in all_findings:
        pii_type = finding["type"]
        summary[pii_type] = summary.get(pii_type, 0) + 1

    return {
        "file": str(pdf_path),
        "total_findings": len(all_findings),
        "summary": summary,
        "page_extraction_methods": page_methods,
        "findings": all_findings
    }


# =========================
# Main Program
# =========================

def main():
    parser = argparse.ArgumentParser(
        description="Scan a PDF for possible SSNs, credit cards, bank info, and DOBs. Supports OCR for scanned PDFs."
    )

    parser.add_argument(
        "pdf",
        help="Path to the PDF file to scan"
    )

    parser.add_argument(
        "-o",
        "--output",
        help="Optional path to save JSON results"
    )

    parser.add_argument(
        "--no-ocr",
        action="store_true",
        help="Disable OCR fallback"
    )

    parser.add_argument(
        "--ocr-threshold",
        type=int,
        default=30,
        help="If extracted page text is below this character count, OCR is attempted. Default: 30"
    )

    parser.add_argument(
        "--dpi",
        type=int,
        default=300,
        help="DPI used when rendering PDF pages for OCR. Default: 300"
    )

    parser.add_argument(
        "--tesseract-cmd",
        help=r"Optional full path to tesseract.exe, for example: C:\Program Files\Tesseract-OCR\tesseract.exe"
    )

    args = parser.parse_args()

    if args.tesseract_cmd:
        pytesseract.pytesseract.tesseract_cmd = args.tesseract_cmd

    pdf_path = Path(args.pdf)

    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")

    if pdf_path.suffix.lower() != ".pdf":
        raise ValueError("Input file must be a PDF.")

    results = scan_pdf(
        pdf_path=pdf_path,
        use_ocr=not args.no_ocr,
        ocr_threshold=args.ocr_threshold,
        dpi=args.dpi
    )

    print(json.dumps(results, indent=4))

    if args.output:
        output_path = Path(args.output)
        output_path.write_text(json.dumps(results, indent=4), encoding="utf-8")
        print(f"\nResults saved to: {output_path}")


if __name__ == "__main__":
    main()