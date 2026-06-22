# Local Testing Guide — Backend Document Flow (Phase 1)

The upload / redaction / storage flow now runs through the **FastAPI backend**
instead of the browser talking to S3 directly. This guide gets the full stack
running on your machine so you can test it end to end.

> You need **three** things running/configured: the Supabase project (shared,
> already live), the **backend** (FastAPI, new), and the **frontend** (Vite).

---

## 0. One-time: a shared database change (coordinate — run ONCE for the whole team)

Migration `15_revoke_redacted_documents_owner_write.sql` must be applied to the
shared Supabase project **one time by one person** (not once per teammate).
Whoever does it: paste the file's contents into the Supabase SQL editor and run
it. If someone has already run it, skip this step.

Check the `#dev` channel before running so we don't double-apply.

---

## 1. Pull the latest code

```bash
git checkout main
git pull
```

---

## 2. Backend setup

### 2a. Get your `backend/.env`

Copy the team `.env` from OneDrive into the `backend/` folder. **Then verify
these two values are correct** — the OneDrive copy has had wrong values in the
past:

```
AWS_REGION=us-east-2
S3_BUCKET_REDACTED=prompt-patrol-doc-storage
```

If yours says `us-east-1` or `promptpatrol-redacted`, fix them to the above.
`backend/.env` is gitignored — never commit it.

### 2b. Create the virtual environment and install dependencies

**`boto3` is a new dependency this phase — you must re-run the install even if
you set up the backend before.**

macOS / Linux:
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Windows (PowerShell):
```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

> Use Python **3.11–3.13**. 3.14 works locally but our deploy target (Lambda)
> is 3.13, so prefer staying at or below that.

### 2c. Run the backend

```bash
uvicorn app.main:app --reload
```

It serves at `http://localhost:8000`. Leave this terminal running. Sanity check:
open `http://localhost:8000/docs` — you should see the `/documents/*` routes.

---

## 3. Frontend setup

In a **second terminal**:

```bash
cd web
npm install
npm run dev
```

The `web/.env` is committed, so `VITE_API_URL=http://localhost:8000` is already
set — no changes needed. Open the URL Vite prints (usually
`http://localhost:5173`).

---

## 4. Test the flow

1. Log in (or request an account → have an admin approve it) and pass MFA.
2. On the dashboard, click **Upload** and pick a `.pdf`, `.docx`, `.txt`, or
   `.rtf` file.
3. On the redaction screen you'll see **placeholder findings** — this is
   expected (see note below).
4. Click **Apply Redactions**. You should land back on the dashboard with the
   document listed as **Stored**.
5. From the row's **⋮** menu, try **View**, **Download**, and **Delete**.
   - View/Download open the file via a short-lived presigned URL (it downloads
     with the original filename, not the S3 UUID).
   - Delete removes both the S3 object and the database rows.

### Watch the backend terminal

Every action prints a request line. Errors (bad AWS creds, RLS issues, etc.)
show up there with a stack trace — that's the first place to look if something
fails.

---

## Known / expected behavior (NOT bugs)

- **The redaction screen shows a fixed dummy document, not your file's real
  content.** The detection engine (`backend/app/ml/engine.py`) is a stub that
  returns placeholder findings regardless of input — the real spaCy/regex
  pipeline is still in progress. When it lands, it's a two-function swap in
  `engine.py`; nothing else changes.
- **The stored file is not actually redacted yet.** Because the engine is a
  stub, the artifact in S3 is currently the unmodified original, just renamed.
- **S3 object names are UUIDs** (e.g. `9e8e0ca8-…3fe9.txt`), not the original
  filename — intentional (avoids collisions and keeps sensitive names out of
  object keys). The human-readable name is stored in the DB and restored on
  download.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Backend won't start, error mentions `allowed_origins` | Pull latest — fixed in `settings.py`. Your code is stale. |
| `ModuleNotFoundError: boto3` | You skipped the re-install. Re-run `pip install -r requirements.txt` in the activated venv. |
| Upload fails, backend log shows an S3 / `AccessDenied` error | Check `AWS_REGION` and `S3_BUCKET_REDACTED` in `backend/.env` (step 2a). |
| `redacted_documents`/insert error on Apply | Migration 15 step (section 0) hasn't been run on the shared DB. |
| Frontend loads but every document action fails | Backend isn't running, or `VITE_API_URL` doesn't point at it. Confirm `http://localhost:8000/docs` opens. |
| 401 / "Invalid token" from the backend | Your login session expired — sign out and back in. |
