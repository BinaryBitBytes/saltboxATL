-- Per-user allow list for divisions.
-- Null means the role's default. An array is the explicit grant.

ALTER TABLE users ADD COLUMN IF NOT EXISTS allowed_divisions JSONB;
