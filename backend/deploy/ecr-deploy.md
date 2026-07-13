# Phase 5 Deploy — Backend as a Container Image (ECR + Lambda, arm64)

Moves the backend from a zip Lambda to a **container-image Lambda** so the heavy
redaction engine (PyTorch / easyocr / spaCy-large / presidio) fits.

**Prerequisites:**
- **Docker Desktop installed and running.**
- AWS CLI configured as the admin `promptpatrol` user.
- Run from the `backend/` directory.

Set some shell variables first:

```bash
export AWS_DEFAULT_REGION=us-east-2
ACCOUNT=533266965830
ECR=$ACCOUNT.dkr.ecr.us-east-2.amazonaws.com
```

---

## 1. Create the ECR repository

```bash
aws ecr create-repository --repository-name promptpatrol-backend
```
*(If it already exists, ignore the error.)*

## 2. Log Docker in to ECR

```bash
aws ecr get-login-password | docker login --username AWS --password-stdin $ECR
```
✅ Ends with `Login Succeeded`.

## 3. Build and push the image (arm64)

`--provenance=false` is **required**: without it, buildx attaches an attestation
manifest that turns the image into a multi-manifest index, and Lambda rejects it
with *"image manifest, config or layer media type ... is not supported."*

```bash
docker buildx build --platform linux/arm64 --provenance=false --sbom=false \
  -t $ECR/promptpatrol-backend:latest --push .
```
First build is **slow** (downloads PyTorch + bakes models) and produces a
multi-GB image. If it fails on a missing system library, add the package to the
`dnf install` line in the `Dockerfile` and rebuild.

## 4. (Pushed already)

The `--push` in step 3 uploaded it to ECR — skip to step 5.

## 5. Swap the Lambda from zip to image

A function's package type can't change in place, so we delete and recreate with
the **same name** (which keeps the API Gateway integration valid).

```bash
# Delete the old zip function (this also drops its invoke permission — re-added in step 6).
aws lambda delete-function --function-name promptpatrol-backend

# Recreate as a container-image function.
aws lambda create-function \
  --function-name promptpatrol-backend \
  --package-type Image \
  --code ImageUri=$ECR/promptpatrol-backend:latest \
  --role arn:aws:iam::$ACCOUNT:role/promptpatrol-backend-lambda \
  --architectures arm64 \
  --timeout 60 \
  --memory-size 3008 \
  --environment '{"Variables":{"ENVIRONMENT":"production","ALLOWED_ORIGINS":"http://localhost:5173,https://dv0rezuo5ctw7.cloudfront.net","S3_BUCKET_REDACTED":"prompt-patrol-doc-storage","S3_BUCKET_AUDIT":"prompt-patrol-audit-log"}}'
```

> Memory is 3008 MB for PyTorch headroom — bump it (up to 10240) if you see
> out-of-memory errors in the logs. Timeout is 60s, but remember API Gateway
> still caps the *response* at 30s (see the caveat at the bottom).

## 6. Re-grant API Gateway permission

Deleting the function removed its resource policy, so add it back:

```bash
aws lambda add-permission \
  --function-name promptpatrol-backend \
  --statement-id apigateway-invoke \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:us-east-2:$ACCOUNT:30zev1yw8g/*/*"
```

## 7. Wait, then test

```bash
aws lambda wait function-active --function-name promptpatrol-backend
curl https://30zev1yw8g.execute-api.us-east-2.amazonaws.com/openapi.json
```
✅ JSON back = the container is live. Then test a **real scan** on the live site
(`https://dv0rezuo5ctw7.cloudfront.net`). The first scan after idle is a slow
cold start (loading models) — that's expected.

## 8. Redeploy the frontend

So production's UI matches the new engine:

```bash
cd ../web && ./deploy_frontend.sh
```

---

## Updating later (after engine changes)

Subsequent updates don't need the delete/recreate — just rebuild, push, and
point the function at the new image:

```bash
cd backend
docker buildx build --platform linux/arm64 --provenance=false --sbom=false \
  -t $ECR/promptpatrol-backend:latest --push .
aws lambda update-function-code \
  --function-name promptpatrol-backend --image-uri $ECR/promptpatrol-backend:latest
```

---

## Caveat: the 30-second wall

API Gateway HTTP API caps responses at **30 seconds**. A cold start (model
loading) plus OCR on a large scanned PDF can approach that. Text PDFs / TXT /
RTF are fast. Mitigations if you hit timeouts:
- **Keep-warm:** an EventBridge rule pinging the function every 5 min avoids
  cold starts during demos (cheap, stays in the free tier). Ask and I'll script it.
- **More memory:** also raises CPU, speeding model load and inference.
- **Async pattern** (return a job id, poll for the result) — a larger change,
  only if scanned-PDF OCR routinely exceeds 30s.
