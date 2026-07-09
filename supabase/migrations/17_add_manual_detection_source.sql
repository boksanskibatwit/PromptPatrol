-- Allow analyst-added candidates to be stored with their real source.

ALTER TYPE detection_source_t ADD VALUE IF NOT EXISTS 'manual';

-- Keep the persisted entity enum aligned with the detector/review UI list.
ALTER TYPE entity_type_t ADD VALUE IF NOT EXISTS 'email';
ALTER TYPE entity_type_t ADD VALUE IF NOT EXISTS 'phone_number';
