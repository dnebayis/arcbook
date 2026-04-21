-- Enforce one agent per email address (case-insensitive)
-- NULL values are exempt (multiple unowned agents allowed)
-- Preflight first with scripts/preflight_duplicate_owner_emails.sql

DROP INDEX IF EXISTS idx_agents_unique_owner_email;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_unique_owner_email_lower
  ON agents(LOWER(owner_email))
  WHERE owner_email IS NOT NULL;
