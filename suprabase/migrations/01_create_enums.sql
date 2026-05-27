-- Migration 1: Create all custom enum types
-- run this before any table migrations


CREATE TYPE role_t AS ENUM (
    'user',
    'admin'
);

CREATE TYPE user_status_t AS ENUM (
    'active',
    'suspended'
);

-- Account request review status
CREATE TYPE request_status_t AS ENUM (
    'pending',
    'approved',
    'rejected'
);

-- Document processing lifecycle
CREATE TYPE document_status_t AS ENUM (
    'scanning',
    'review',
    'stored',
    'failed'
);

CREATE TYPE file_type_t AS ENUM (
    'pdf',
    'docx',
    'txt',
    'rtf'
);

-- PII entity types detected by NER model and Regex engine
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

-- Which part of the ML pipeline flagged the candidate
CREATE TYPE detection_source_t AS ENUM (
    'ner',
    'regex'
);

-- Per-candidate review decision made by the analyst
CREATE TYPE review_status_t AS ENUM (
    'pending',
    'confirmed',
    'rejected'
);

-- All auditable actions in the system
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