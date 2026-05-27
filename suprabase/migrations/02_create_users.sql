-- Migration 002: Create users table
-- PromptPatrol depends on 001_create_enums.sql

CREATE TABLE users (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    email               VARCHAR(255)    NOT NULL UNIQUE,
    username            VARCHAR(100)    NOT NULL,
    password_hash       VARCHAR(255)    NOT NULL,
    mfa_secret          VARCHAR(64),                        -- encrypted, nullable until MFA is enrolled
    role                role_t          NOT NULL DEFAULT 'user',
    status              user_status_t   NOT NULL DEFAULT 'active',
    last_login_at       TIMESTAMPTZ,                        -- nullable, null until first login
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- ROW level security
alter table users enable row level security;

-- Users can only read their own row
create policy "admin_select_all_users"
  on users
  for select
  using(
    exists(
      select 1 from users
      where id = auth.uid()
      and role = 'admin'
    )
  );


-- Indexes
-- Email is the primary lookup for login
create INDEX idx_users_email on users (email);
 
-- Role index supports admin policy checks
create INDEX idx_users_role on users (role);
