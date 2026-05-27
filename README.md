# PromptPatrol
PromptPatrol is an enterprise-grade AI governance tool designed for financial companies operating under FTC data privacy regulations. The system enforces a structured, auditable workflow that governs how customer information is submitted to AI models. This ensures every interaction is authenticated, reviewed, approved, and then recorded before any sensitive data leaves the organization's network. 

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


To run web commmands

install node.ns from web https://nodejs.org/en/download?utm_source=chatgpt.com 

-reload vs code
-npm install

TO RUN WEBSITE be in ./web
-npm run dev 

