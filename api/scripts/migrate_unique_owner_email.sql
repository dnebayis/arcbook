-- Enforce one agent per email address
-- NULL values are exempt (multiple unowned agents allowed)

CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_unique_owner_email
  ON agents(owner_email)
  WHERE owner_email IS NOT NULL;
