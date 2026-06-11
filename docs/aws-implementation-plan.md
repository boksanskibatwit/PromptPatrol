# AWS Implementation Plan

Maps the cloud architecture diagram (Drawing 11) onto the current codebase, keeping
only the services that earn their place. Existing AWS footprint: one S3 bucket
(`prompt-patrol-doc-storage`, us-east-2) fronted by an API Gateway proxy
(`zj5b3sgryi`, stage `test`) with IAM — see `docs/dashboard-and-upload-flow.md`.

> Region note: the diagram says us-east-1; everything real is in us-east-2.
> Stay in **us-east-2** and update the diagram — moving buys nothing.

---

## Verdict per diagram service

| Service | Verdict | Why |
|---|---|---|
| ECS Fargate — Backend API → **Lambda** | ✅ Keep (replatformed) | The backend must run *somewhere*: redaction, S3 writes, and audit logging belong server-side (the browser can't run spaCy or hold the service-role key). Lambda runs the same FastAPI app via the Mangum adapter, scales to zero, and its 1M-requests/month free tier is **permanent** — vs ~$18/mo for an always-on Fargate task. |
| ECR | ⚠️ Later, with the ML engine | Not needed yet: the stub backend ships as a plain zip Lambda. Once the team's spaCy pipeline lands it won't fit the 250 MB zip limit, so the Lambda moves to a container image (10 GB limit) — ECR storage for one ~1.5 GB image ≈ $0.15/mo. |
| S3 — Frontend bundle + CloudFront | ✅ Keep | Standard SPA hosting; CloudFront's 1 TB/month free tier is permanent; includes Shield Standard DDoS protection. |
| CloudWatch | ✅ Keep | Lambda logs there automatically; 5 GB free tier is plenty. |
| Secrets Manager → **SSM Parameter Store** | ✅ Keep (downgraded) | The backend needs Supabase/S3 creds. Parameter Store `SecureString` does the same job for $0 vs $0.40/secret/mo. |
| S3 — Redacted documents | ✅ Already exists | `prompt-patrol-doc-storage`. Add **versioning**; keep SSE-S3 (KMS optional, see Phase 5). |
| S3 — Audit archive | ✅ Keep (simplified) | Real differentiator for a governance product. Nightly dump via EventBridge + Lambda. |
| ALB | ❌ Skip | ~$17/mo idle — alone it would eat the entire budget. API Gateway (already in the stack) fronts the Lambda; it *is* the load balancer in this architecture. |
| Route 53 + ACM | ⚠️ Only with a custom domain | CloudFront gives you a usable HTTPS domain for free. If you buy a domain (~$13/yr), add Route 53 + ACM then. |
| ECS Fargate — ML service | ❌ Fold into backend | ~60 lines of spaCy/regex (`backend/app/ml/redact_text.py`). Runs in-process inside the backend Lambda. Note: **Fargate has no GPU support** — the diagram's "GPU optional" requires EC2 launch type; `en_core_web_sm` doesn't need one. |
| NAT Gateway | ❌ Skip | ~$32/mo — 3× the entire budget. Lambda outside a VPC reaches Supabase and S3 directly over TLS; no VPC networking needed at all. |
| WAF | ❌ Skip | ~$5/mo + per-rule. Shield Standard (free, automatic with CloudFront) is enough at this scale. Mention WAF as "production roadmap" in the report. |
| Object Lock (Governance/Compliance, 7y) | ❌ Skip / demo-only | Conflicts with the dashboard's working **Delete** feature, and Compliance mode is irreversible — even root can't delete for 7 years. Use **versioning + a deny-delete bucket policy on the audit bucket** to demonstrate the same compliance story safely. |
| Per-user IAM object scope on S3 | ❌ Replace with app-level | Once all S3 access goes through the backend's single task role, per-user IAM is impossible/meaningless. Ownership is already enforced by Supabase RLS + key convention `<documentId>.<ext>`. |
| KMS (SSE-KMS) | ⚠️ Optional | $1/key/mo + per-request. SSE-S3 is also encryption-at-rest. Add to the audit bucket only if the rubric wants customer-managed keys. |

Supabase (Postgres + Auth) stays exactly as is — the diagram already treats it as external.

---

## Phase 1 — Backend document routes with a redaction stub (no new AWS) — ✅ DONE

> The real redaction engine (`backend/app/ml/redact_text.py`) is **incomplete and
> owned by other team members** — do not wire it in yet. This phase builds the
> route structure and a clean seam it will plug into.

1. Redaction seam `backend/app/ml/engine.py`:
   - `analyze(text: str) -> list[Candidate]` — **stub**: returns placeholder
     candidates (same shape `Redact.jsx`'s mock data uses today).
   - `apply(text: str, accepted: list[Candidate]) -> str` — **stub**: pass-through.
   - When the team's pipeline is ready, it replaces these two function bodies;
     nothing else in the stack changes.
2. New router `backend/app/routers/documents.py`:
   - `POST /documents/analyze` — accepts the file, calls `engine.analyze`, returns
     candidate spans for the review screen.
   - `POST /documents/redact` — accepts file + approved candidate ids, calls
     `engine.apply`, `PUT`s the result to S3 via boto3 (creds already in
     `app/core/settings.py`), inserts `documents` / `redacted_documents` /
     `redaction_candidates` rows with the service client.
   - `GET /documents/{id}/download` + `DELETE /documents/{id}` — presigned URL (or
     stream) and delete, with JWT ownership check.
3. Frontend: `Redact.jsx` calls the backend instead of its local mock;
   `lib/storage.js`'s direct-PUT path retires.
4. Supabase: revert migration `09` (client-side `redacted_documents` writes existed
   only because there was no backend). `redaction_candidates` becomes persistable
   via the service role, as the original schema intended.
5. The original file still never touches disk/S3 — it goes browser → backend
   memory → engine → only the (for now, unmodified) artifact persists. The
   stored file isn't truly redacted until the engine lands, same as today — but
   the moment it does, the whole flow becomes real with a two-function swap.

**Exit criteria:** upload → candidates served by the backend → file stored via the
backend; API Gateway S3 proxy no longer called by the browser.

## Phase 2 — Deploy the backend (Lambda + API Gateway) — ✅ DONE

> **Deployed 2026-06-11.** Function `promptpatrol-backend` (python3.13, 512 MB,
> x86_64) behind HTTP API `30zev1yw8g`, region us-east-2. Public endpoint:
> `https://30zev1yw8g.execute-api.us-east-2.amazonaws.com`. Secrets in SSM under
> `/promptpatrol/backend/`; runs as scoped role `promptpatrol-backend-lambda`.
> Deploy steps + commands live in `backend/deploy/README.md`; build via
> `backend/build_lambda.sh`. Full upload → redact → view → download → delete flow
> verified against the deployed backend.
>
> **Two gotchas hit (worth a line in the report):**
> 1. *Lambda role credentials are temporary* — they include a **session token**,
>    so `s3.py` must let boto3's default chain assemble them, not pass just
>    key+secret (that fails with `InvalidAccessKeyId`).
> 2. *API Gateway `create-api --target` does not add the Lambda invoke
>    permission* — it must be granted explicitly with `lambda add-permission`
>    using the real `ApiId`.

1. Add `mangum` to `backend/requirements.txt` and a `handler = Mangum(app)` line
   in `app/main.py` — FastAPI runs on Lambda unchanged.
2. Package as a **plain zip Lambda** (the stub backend has no spaCy, so it fits
   the 250 MB limit easily). When the team's spaCy pipeline lands, switch to a
   container-image Lambda (10 GB limit) pushed to ECR — that's the only
   deployment change the engine will require.
3. SSM Parameter Store `SecureString`s for `DATABASE_URL`, Supabase keys,
   `JWT_SECRET`, bucket names; read at cold start (cache in a module global).
4. API Gateway **HTTP API** → Lambda proxy integration (cheaper and simpler than
   the REST flavor already used for the S3 proxy). Memory 512 MB–1 GB.
   Execution role: `s3:PutObject/GetObject/DeleteObject` on the doc bucket only.
5. CloudWatch logs come automatically; add one alarm on Lambda errors.
6. Frontend `.env`: point the API base URL at the HTTP API endpoint.

**Known Lambda constraint:** API Gateway caps request bodies at 10 MB (~7 MB
after base64). Cap uploads at ~5 MB client-side and document it; course documents
fit comfortably. (The alternative — presigned-URL uploads of originals to S3 —
would violate the "originals are never persisted" principle.)

## Phase 3 — Frontend hosting (S3 + CloudFront) — ✅ DONE

> **Deployed 2026-06-11.** Live at `https://dv0rezuo5ctw7.cloudfront.net`.
> Private bucket `promptpatrol-frontend` (us-east-2, Block Public Access ON),
> served only via CloudFront distribution `E3L5CANT2P5KQ5` using Origin Access
> Control. Default root `index.html`; custom error responses 403 **and** 404 →
> `/index.html` (200) for SPA routing under `BrowserRouter`. Redeploy with
> `web/deploy_frontend.sh` (build → `s3 sync --delete` → CloudFront
> invalidation). Lambda `ALLOWED_ORIGINS` now includes the CloudFront origin;
> the CloudFront URL was added to Supabase Auth Site URL + redirect allowlist.
>
> **Gotcha hit:** CORS origins are matched **exactly, including scheme** — the
> `ALLOWED_ORIGINS` entry must be `https://dv0rezuo5ctw7.cloudfront.net`, not the
> bare host. A missing `https://` silently blocks every API call.

1. Private bucket `promptpatrol-frontend` + CloudFront distribution with Origin
   Access Control; default root `index.html`, 403/404 → `/index.html` (SPA routing).
2. `npm run build` → `aws s3 sync web/dist/ s3://promptpatrol-frontend` →
   CloudFront invalidation. Optionally a GitHub Action.
3. Add the CloudFront domain to `allowed_origins` in backend settings and to
   Supabase Auth redirect URLs (password reset emails link back to the site).
4. Route 53 + ACM only if a custom domain is purchased.

## Phase 4 — Audit archive

1. Bucket `promptpatrol-audit`: versioning + bucket policy denying
   `s3:DeleteObject` to everything except an admin break-glass role (the safe
   stand-in for Object Lock).
2. Lambda (python, `pg_dump` layer or `COPY ... TO STDOUT` via psycopg) dumping
   `audit_log_entries` + `documents` + `account_requests` to
   `s3://promptpatrol-audit/YYYY/MM/DD.sql.gz`, triggered nightly by an
   EventBridge Scheduler rule.
3. Backend writes `audit_log_entries` rows on every sensitive action (login,
   approve/reject, upload, redact, download, delete) — table already exists in
   migration `08`; nothing writes to it yet.

## Phase 5 — Later / optional

- **Swap in the real redaction engine** when the team's `redact_text.py` pipeline
  is complete: replace the two stub bodies in `app/ml/engine.py`, move the Lambda
  to a container image (spaCy won't fit the zip limit), bump memory to ~2 GB.
- Retire or lock down the old API Gateway S3 proxy once nothing calls it
  (it currently allows unauthenticated PUT/DELETE to the bucket — close it
  no later than end of Phase 2). Remove the leftover `__probe__.txt`.
- SSE-KMS on the audit bucket / WAF on CloudFront — only if the rubric demands;
  otherwise list as "production roadmap" in the report alongside the diagram's
  ALB + Fargate posture (the report can present Lambda as the cost-engineered
  equivalent of the diagram's compute layer).

---

## Rough monthly cost (us-east-2, demo posture, free-tier account)

Budget ceiling: **$10/mo**.

| Item | Cost |
|---|---|
| Lambda backend (1M req + 400k GB-s free, **permanent**) | $0 |
| API Gateway HTTP API (1M req free 12 mo; $1/M after) | $0 |
| S3 (3 buckets, demo-scale data) + CloudFront (1 TB free, permanent) | < $1 |
| SSM Parameter Store, EventBridge, CloudWatch (within free tiers) | $0 |
| ECR (only once the spaCy container image lands, ~1.5 GB) | ~$0.15 |
| **Total** | **≈ $1/mo** (vs ~$120+/mo for the diagram-literal ALB + NAT + Fargate build) |

Headroom against the $10 ceiling is ~9× — safe even if traffic spikes during
demos or the 12-month API Gateway free tier lapses mid-project.
