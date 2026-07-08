# Container image for the PromptPatrol backend Lambda (Phase 5).
#
# The redaction engine (presidio + spaCy en_core_web_lg + PyTorch/easyocr +
# PyMuPDF) is far past a zip Lambda's 250 MB limit, so we ship it as a container
# image (10 GB limit). Models are baked in at BUILD time because the Lambda
# filesystem is read-only at runtime (only /tmp is writable) — a runtime model
# download would fail.
#
# Built for arm64 (Graviton). See backend/deploy/ecr-deploy.md.

FROM public.ecr.aws/lambda/python:3.13

# System libraries some ML wheels load at runtime: OpenCV (via easyocr) needs
# libGL; libgomp is OpenMP for numpy/torch threading. If a build or run reports
# a missing .so, add the providing package here.
# NOTE: if "dnf: command not found" on first build, swap dnf -> microdnf.
RUN dnf install -y mesa-libGL libgomp && dnf clean all

# Python dependencies (PyTorch comes in via easyocr — this layer is large).
COPY requirements.txt ${LAMBDA_TASK_ROOT}/
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt

# Bake the spaCy model presidio loads at import time.
RUN python -m spacy download en_core_web_lg

# Application code.
COPY app ${LAMBDA_TASK_ROOT}/app

# Bake the easyocr 'en' models into the exact directory the engine reads
# (app/ml/ocr_models), so scanned-PDF OCR works without a runtime download.
RUN python -c "import easyocr; easyocr.Reader(['en'], gpu=False, model_storage_directory='${LAMBDA_TASK_ROOT}/app/ml/ocr_models', download_enabled=True)"

# Lambda handler: FastAPI via Mangum (app/main.py defines `handler`).
CMD ["app.main.handler"]
