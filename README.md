# PromptPatrol


## Database Migrations

Migration files are located in `/supabase/migrations` and **must be run in order**.

1. `01_create_enums.sql`
2. `02_create_users.sql`
3. `03_create_account_requests.sql`
4. `04_create_sessions.sql`
5. `05_create_documents.sql`
6. `06_create_redaction_candidates.sql`
7. `07_create_redacted_documents.sql`
8. `08_create_audit_log_entries.sql`

To run: copy the contents of each file into the Supabase SQL editor and execute them one at a time in the order listed above.
