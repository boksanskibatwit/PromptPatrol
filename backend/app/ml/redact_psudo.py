from presidio_analyzer import AnalyzerEngine, PatternRecognizer, Pattern
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import RecognizerResult
import re
from pathlib import Path

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
def run(input_file, output_file):
    text = Path(input_file).read_text(encoding="utf-8")

    redacted, findings = redact(text)

    Path(output_file).write_text(redacted, encoding="utf-8")

    print("\n=== FINDINGS ===")
    for f in findings:
        print(f"{f.entity_type} -> {text[f.start:f.end]}")

    print(f"\nSaved: {output_file}")


# =========================
# ENTRY
# =========================
if __name__ == "__main__":
    run("testfile.txt", "redacted_output.txt")