-- Migration 1: Create all custom enum types
-- run this before any table migrations


DO $$
BEGIN
    CREATE TYPE role_t AS ENUM (
        'user',
        'admin'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE user_status_t AS ENUM (
        'active',
        'suspended'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Account request review status
DO $$
BEGIN
    CREATE TYPE request_status_t AS ENUM (
        'pending',
        'approved',
        'rejected'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Document processing lifecycle
DO $$
BEGIN
    CREATE TYPE document_status_t AS ENUM (
        'scanning',
        'review',
        'stored',
        'failed'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE file_type_t AS ENUM (
        'pdf',
        'docx',
        'txt',
        'rtf'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- PII entity types detected by NER model and Regex engine
DO $$
BEGIN
    CREATE TYPE entity_type_t AS ENUM (
        'person_name',
        'company_name',
        'location',
        'date_of_birth',
        'ssn',
        'account_number',
        'credit_card',
        'routing_number',
        'date'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Which part of the ML pipeline flagged the candidate
DO $$
BEGIN
    CREATE TYPE detection_source_t AS ENUM (
        'ner',
        'regex'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- Per-candidate review decision made by the analyst
DO $$
BEGIN
    CREATE TYPE review_status_t AS ENUM (
        'pending',
        'confirmed',
        'rejected'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- All auditable actions in the system
DO $$
BEGIN
    CREATE TYPE audit_action_t AS ENUM (
        'LOGIN_ATTEMPT',
        'LOGIN',
        'LOGOUT',
        'MFA_ENROLL',
        'MFA_RESET',
        'ACCOUNT_REQUEST',
        'ACCOUNT_APPROVE',
        'ACCOUNT_REJECT',
        'USER_UPDATE',
        'USER_SUSPEND',
        'USER_REACTIVATE',
        'UPLOAD',
        'RESCAN',
        'REVIEW_CONFIRM',
        'REDACT',
        'DOWNLOAD',
        'DOCUMENT_DELETE',
        'AUDIT_VERIFY',
        'EXPORT'
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
