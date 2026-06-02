import re
import spacy
from pathlib import Path

# =========================
# Load SpaCy
# =========================
nlp = spacy.load("en_core_web_sm")

# =========================
# Regex Patterns
# =========================
PATTERNS = {
    "SSN": re.compile(r"\b\d{3}-\d{2}-\d{4}\b"),
    "EMAIL": re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"),
    "PHONE": re.compile(r"\b\d{3}-\d{3}-\d{4}\b"),
    "CREDIT_CARD": re.compile(r"\b(?:\d[ -]*?){13,19}\b")
}

NER_LABELS = {"PERSON", "ORG", "GPE", "DATE"}


# =========================
# Collect regex spans
# =========================
def collect_regex(text):
    spans = []
    findings = []

    for label, pattern in PATTERNS.items():
        for m in pattern.finditer(text):
            spans.append((m.start(), m.end(), label))
            findings.append((label, m.group()))

    return spans, findings


# =========================
# Clean text for SpaCy
# =========================
def clean_for_ner(text):
    # remove placeholders so spaCy doesn't hallucinate entities
    return re.sub(r"\[REDACTED_[A-Z_]+\]", "", text)


# =========================
# SpaCy entity extraction
# =========================
def collect_ner(text):
    doc = nlp(clean_for_ner(text))

    spans = []
    findings = []

    for ent in doc.ents:
        if ent.label_ in NER_LABELS:
            spans.append((ent.start_char, ent.end_char, ent.label_))
            findings.append((ent.label_, ent.text))

    return spans, findings


# =========================
# Merge spans (regex wins)
# =========================
def merge_spans(regex_spans, ner_spans):
    combined = []

    for s, e, l in regex_spans:
        combined.append((s, e, l, 0))  # regex priority = 0

    for s, e, l in ner_spans:
        combined.append((s, e, l, 1))  # ner priority = 1

    combined.sort(key=lambda x: (x[0], x[3]))

    merged = []
    last_end = -1

    for s, e, label, _ in combined:
        if s < last_end:
            continue
        merged.append((s, e, label))
        last_end = e

    return merged


# =========================
# Safe renderer (NO bugs)
# =========================
def render(text, spans):
    spans = sorted(spans, key=lambda x: x[0])

    out = []
    last = 0

    for start, end, label in spans:
        out.append(text[last:start])
        out.append(f"[REDACTED_{label}]")
        last = end

    out.append(text[last:])
    return "".join(out)


# =========================
# Main pipeline
# =========================
def redact(text):
    regex_spans, regex_findings = collect_regex(text)
    ner_spans, ner_findings = collect_ner(text)

    all_spans = merge_spans(regex_spans, ner_spans)

    redacted_text = render(text, all_spans)

    return redacted_text, regex_findings + ner_findings


# =========================
# File runner
# =========================
def redact_file(input_file, output_file):
    text = Path(input_file).read_text(encoding="utf-8")

    redacted, findings = redact(text)

    Path(output_file).write_text(redacted, encoding="utf-8")

    print("\n=== FINDINGS ===")
    for label, value in findings:
        print(f"{label} -> {value}")

    print(f"\nSaved to: {output_file}")


if __name__ == "__main__":
    redact_file("testfile.txt", "redacted_output.txt")