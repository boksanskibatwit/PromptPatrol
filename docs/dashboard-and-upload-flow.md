# Dashboard & Upload / Redaction Flow

This document covers the analyst-facing web flow added on top of the existing
auth pages: the **dashboard**, the **upload → redaction review → S3 storage**
pipeline, and the supporting storage/RLS layer.

> Status: the redaction **algorithm is not yet wired in**. The redaction review
> screen shows placeholder findings and stores the file as-is. Everything else
> (auth gating, S3 round-trip, DB metadata, dashboard actions) is real.

---

## User journey

```
Login → MFA verify → /dashboard
                         │  click "Upload" → pick file
                         ▼
                      /redact  (original file held in memory only)
                         │  review candidates → "Apply Redactions"
                         ▼
        documents row + PUT to S3 + redacted_documents row
                         │
                         ▼
                      /dashboard  (file appears; View / Download / Delete)
```

**Core principle:** the original (un-redacted) file is **never persisted**. It
lives in browser memory through the redaction step; only the redacted artifact
is written to S3.

---

## Files

### Frontend (`web/src/`)

| File | Purpose |
|------|---------|
| `pages/Dashboard.jsx` | Document table wired to Supabase `documents` (RLS-scoped to owner). Search, status filter, client-side pagination, profile/sign-out menu, per-row **View / Download / Delete** menu, **Upload** button. |
| `pages/Redact.jsx` | Two-column redaction review screen (matches the wireframe): document **Preview** + **Candidates** cards with checkbox / ✓ confirm / ✗ reject, page Prev/Next, **Apply Redactions**. On apply: writes DB rows + uploads to S3. Mock data for now. |
| `lib/uploadHandoff.js` | Module-level in-memory slot that passes the picked `File` from dashboard → redact page without persisting it. Cleared on read. |
| `lib/storage.js` | S3-via-API-Gateway client: `putObject`, `deleteObject` (need CORS), `objectUrl` / `objectKeyFor` for view/download via navigation (no CORS). |
| `App.jsx` | Adds `/dashboard` and `/redact` as full-page routes. |
| `index.css` | `dash-*` and `redact-*` style blocks (plain CSS, matching the `login-*`/`mfa-*`/`req-*` convention — no Tailwind). |
| `index.html` | Adds the **Material Symbols Outlined** icon font. |
| `.env` | Adds `VITE_S3_API_URL` and `VITE_S3_BUCKET`. |

### Database (`supabase/migrations/`)

| File | Purpose |
|------|---------|
| `09_redacted_documents_owner_write.sql` | Adds owner `INSERT`/`UPDATE` RLS policies on `redacted_documents` so the client can record the S3 location. (The original schema reserved this for the service role; we have no backend yet.) Delete relies on the existing `ON DELETE CASCADE` from `documents`. |

---

## Storage layer

S3 is reached through an API Gateway proxy. Routes are shaped:

```
{VITE_S3_API_URL}/{VITE_S3_BUCKET}/{filename}
```

- `VITE_S3_API_URL` = `https://zj5b3sgryi.execute-api.us-east-2.amazonaws.com/test`
- `VITE_S3_BUCKET`  = `prompt-patrol-doc-storage`

**Object key convention:** `<documentId>.<ext>` (e.g. `a1b2…f9.pdf`). The key is
derived from the `documents.id`, so the dashboard can compute it without storing
it separately. The canonical location is also recorded in `redacted_documents`
(`s3_bucket`, `s3_object_key`).

**CORS note:** `PUT` and `DELETE` from the browser require CORS on the API
Gateway. `GET`-based View/Download use top-level navigation (`window.open` / an
`<a download>` click), which is **not** subject to CORS.

---

## What stores where, on "Apply Redactions"

1. `INSERT` into `documents` — `owner_id`, `original_filename`, `file_type`,
   `size_bytes`, `status='stored'`, `completed_at=now()`.
2. `PUT` the file to S3 at `<documentId>.<ext>`.
3. `INSERT` into `redacted_documents` — `source_document_id`, `s3_bucket`,
   `s3_object_key`, `file_type`, `size_bytes`, `written_to_s3_at=now()`.

**Rollback:** if the S3 PUT fails, the `documents` row is deleted. If the
`redacted_documents` insert fails, the S3 object is deleted and the `documents`
row is removed — so there are never orphaned rows or files.

Supported file types (per `file_type_t`): `pdf`, `docx`, `txt`, `rtf`.

---

## AWS / deployment prerequisites

API Gateway (`zj5b3sgryi`, region `us-east-2`, stage `test`) is now configured:

1. ✅ **`GET`, `PUT`, `DELETE`, `OPTIONS`** methods exist on `/{bucket}/{filename}`.
2. ✅ **CORS** is working — `OPTIONS` preflight returns `200` with
   `Access-Control-Allow-Methods: GET,PUT,DELETE,OPTIONS`,
   `Access-Control-Allow-Headers: Content-Type`, `Access-Control-Allow-Origin: *`.
3. ⚠️ **Run migration `09`** in the Supabase SQL editor (if not already), or the
   `redacted_documents` insert is denied by RLS and every upload rolls back.

### Gotcha: CORS MOCK `OPTIONS` vs `binaryMediaTypes: */*`

The API sets `binaryMediaTypes: ["*/*"]` so binary files can be PUT/GET to S3.
That made the CORS `OPTIONS` MOCK fail at runtime ("Unable to transform request"
→ 500), because the MOCK applies a JSON request template to a binary-handled
request. **Fix (already applied):** on the `OPTIONS` method's MOCK integration,
set `contentHandling = CONVERT_TO_TEXT` and `passthroughBehavior = WHEN_NO_MATCH`,
then redeploy. Do **not** remove `binaryMediaTypes` — it's needed for uploads/
downloads. (`WHEN_NO_TEMPLATES` does not work for this.)

---

## Known limitations / TODO

- **Redaction algorithm not connected.** `Redact.jsx` uses `MOCK_PAGES` /
  placeholder candidates and stores the original bytes as the "redacted" file.
  Wire in the `backend/app/ml/redact_text.py` pipeline (needs a backend route).
- **docx ↔ pdf conversion on download is deferred.** Download currently returns
  the file in its stored (native) format. True conversion needs a backend
  service (e.g. LibreOffice/pandoc); `lib/storage.js` leaves a clean seam.
- **`redaction_candidates` are not persisted.** The review decisions are
  in-memory only (that table is service-role-insert-only and there's no backend).
- A 5-byte `__probe__.txt` may exist in the bucket from API testing; remove it.
