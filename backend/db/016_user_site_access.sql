-- Per-user allow and deny list for work sites.
-- Null means the role's default access. An array is the explicit grant.

ALTER TABLE users ADD COLUMN IF NOT EXISTS allowed_site_ids JSONB;
