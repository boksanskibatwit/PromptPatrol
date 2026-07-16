# Phase 2 Deploy — Backend to AWS Lambda + API Gateway

Run these once to put the backend on the public internet. Everything lives in
**us-east-2**, account **533266965830**.

**Before you start:**
- AWS CLI installed and configured with your admin credentials (`aws sts get-caller-identity` should show the `promptpatrol` user).
- Run all commands from the `backend/` directory.
- Set the region once for this shell so you don't repeat it:

```bash
export AWS_DEFAULT_REGION=us-east-2
```

---

## 1. Upload secrets to SSM Parameter Store

These are the values the Lambda reads at startup. **Copy each value from your
`backend/.env`** (replace `PASTE_...`). `--type SecureString` encrypts them at
rest. Safe to re-run to change a value.

```bash
aws ssm put-parameter --type SecureString --overwrite \
  --name "/promptpatrol/backend/DATABASE_URL" --value "PASTE_DATABASE_URL"

aws ssm put-parameter --type SecureString --overwrite \
  --name "/promptpatrol/backend/SUPABASE_URL" --value "PASTE_SUPABASE_URL"

aws ssm put-parameter --type SecureString --overwrite \
  --name "/promptpatrol/backend/SUPABASE_ANON_KEY" --value "PASTE_SUPABASE_ANON_KEY"

aws ssm put-parameter --type SecureString --overwrite \
  --name "/promptpatrol/backend/SUPABASE_SERVICE_ROLE_KEY" --value "PASTE_SERVICE_ROLE_KEY"

aws ssm put-parameter --type SecureString --overwrite \
  --name "/promptpatrol/backend/JWT_SECRET" --value "PASTE_JWT_SECRET"

aws ssm put-parameter --type SecureString --overwrite \
  --name "/promptpatrol/backend/ML_SERVICE_SECRET" --value "PASTE_ML_SERVICE_SECRET"
```

> The AWS keys from `.env` are **not** uploaded — on Lambda the execution role
> (step 2) provides AWS access automatically.

---

## 2. Create the IAM execution role

This is the scoped role the Lambda runs as — S3 on your bucket + read its
secrets, nothing else.

```bash
# Create the role (trust policy lets Lambda assume it)
aws iam create-role \
  --role-name promptpatrol-backend-lambda \
  --assume-role-policy-document file://deploy/trust-policy.json

# Managed policy: write CloudWatch logs
aws iam attach-role-policy \
  --role-name promptpatrol-backend-lambda \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

# Custom policy: S3 + SSM + KMS-via-SSM
aws iam put-role-policy \
  --role-name promptpatrol-backend-lambda \
  --policy-name promptpatrol-backend-access \
  --policy-document file://deploy/lambda-execution-policy.json
```

---

## 3. Build the deployment zip

```bash
./build_lambda.sh
```

Produces `backend/lambda.zip` with Linux-compatible dependencies.

---

## 4. Create the Lambda function

`ENVIRONMENT`, `ALLOWED_ORIGINS`, and the bucket names are non-secret config, so
they're plain environment variables. `ALLOWED_ORIGINS` is set to your local dev
origin for now — we add the CloudFront URL in Phase 3.

```bash
aws lambda create-function \
  --function-name promptpatrol-backend \
  --runtime python3.13 \
  --architectures x86_64 \
  --handler app.main.handler \
  --role arn:aws:iam::533266965830:role/promptpatrol-backend-lambda \
  --zip-file fileb://lambda.zip \
  --timeout 30 \
  --memory-size 512 \
  --environment "Variables={ENVIRONMENT=production,ALLOWED_ORIGINS=http://localhost:5173,S3_BUCKET_REDACTED=prompt-patrol-doc-storage,S3_BUCKET_AUDIT=promptpatrol-audit}"
```

> If this fails with *"The role cannot be assumed by Lambda"*, IAM just hasn't
> propagated yet — wait ~10 seconds and re-run.

---

## 5. Create the API Gateway HTTP API (the public URL)

```bash
aws apigatewayv2 create-api \
  --name promptpatrol-backend \
  --protocol-type HTTP \
  --target arn:aws:lambda:us-east-2:533266965830:function:promptpatrol-backend
```

Copy two things from the output: **`ApiEndpoint`** (the URL, like
`https://abc123.execute-api.us-east-2.amazonaws.com`) and **`ApiId`** (the
`abc123` part).

Then let API Gateway invoke the Lambda (replace `<ApiId>`):

```bash
aws lambda add-permission \
  --function-name promptpatrol-backend \
  --statement-id apigateway-invoke \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:us-east-2:533266965830:<ApiId>/*/*"
```

---

## 6. Test it

```bash
curl https://<ApiEndpoint>/openapi.json
```

A wall of JSON = the backend is live on Lambda. (A 500 here usually means a
missing/typo'd SSM secret — check the CloudWatch logs for the function.)

---

## 7. Hand off

Send the **`ApiEndpoint`** URL back to the chat — that gets wired into
`web/.env` so the frontend talks to the deployed backend, then we test the full
upload flow end to end.

---

## Updating the backend later (after any code change)

```bash
./build_lambda.sh
aws lambda update-function-code \
  --function-name promptpatrol-backend \
  --zip-file fileb://lambda.zip
```

Changing a secret? Re-run that one `put-parameter` from step 1 — the new value
is picked up on the Lambda's next cold start.

---

## Viewing logs (when something breaks)

```bash
aws logs tail /aws/lambda/promptpatrol-backend --follow
```
