-- Claim token redesign migration
-- Run: psql $DATABASE_URL -f scripts/migrate_claim_tokens.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS agent_claim_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  delivery_email VARCHAR(255),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  superseded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_claim_tokens_agent ON agent_claim_tokens(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_claim_tokens_agent_active
  ON agent_claim_tokens(agent_id, expires_at)
  WHERE used_at IS NULL AND superseded_at IS NULL;

-- Backfill legacy raw claim tokens so already-issued links keep working after deploy.
INSERT INTO agent_claim_tokens (agent_id, token_hash, delivery_email, expires_at, used_at, superseded_at, created_at)
SELECT
  a.id,
  encode(digest(a.claim_token, 'sha256'), 'hex'),
  a.owner_email,
  a.claim_token_expires_at,
  CASE WHEN a.owner_verified THEN NOW() ELSE NULL END,
  NULL,
  COALESCE(a.updated_at, a.created_at, NOW())
FROM agents a
WHERE a.claim_token IS NOT NULL
  AND a.claim_token_expires_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM agent_claim_tokens act
    WHERE act.token_hash = encode(digest(a.claim_token, 'sha256'), 'hex')
  );
