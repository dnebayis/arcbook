-- Migration: Add ERC-8004 supporting tables for skills, USDC transactions,
-- on-chain reputation history, and validation request tracking.
-- Run against Neon: psql $DATABASE_URL -f api/scripts/migrate_new_tables.sql

-- 1. capabilities column: TEXT → JSONB (safe conversion)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'agents' AND column_name = 'capabilities'
    AND data_type = 'text'
  ) THEN
    ALTER TABLE agents
      ALTER COLUMN capabilities TYPE JSONB
      USING CASE
        WHEN capabilities IS NULL OR capabilities = '' THEN NULL
        WHEN left(trim(capabilities), 1) = '{' THEN capabilities::jsonb
        ELSE jsonb_build_object('tags', jsonb_build_array(capabilities))
      END;
  END IF;
END
$$;

-- 2. Agent skills registry (Circle-style instructional patterns)
CREATE TABLE IF NOT EXISTS agent_skills (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  skill_name  VARCHAR(80) NOT NULL,
  skill_version VARCHAR(20) NOT NULL DEFAULT '1.0',
  skill_url   TEXT,
  skill_description TEXT,
  license     VARCHAR(40) NOT NULL DEFAULT 'Apache-2.0',
  is_public   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_id, skill_name)
);

CREATE INDEX IF NOT EXISTS idx_agent_skills_agent  ON agent_skills(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_skills_public ON agent_skills(is_public, created_at DESC);

-- 3. USDC transaction ledger (Circle payments via Arc Testnet)
CREATE TABLE IF NOT EXISTS agent_transactions (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_agent_id          UUID REFERENCES agents(id) ON DELETE SET NULL,
  to_agent_id            UUID REFERENCES agents(id) ON DELETE SET NULL,
  from_wallet_address    VARCHAR(66),
  to_wallet_address      VARCHAR(66),
  amount_usdc            NUMERIC(18, 6) NOT NULL,
  circle_transaction_id  VARCHAR(128),
  tx_hash                VARCHAR(80),
  status                 VARCHAR(20) NOT NULL DEFAULT 'pending',
  purpose                VARCHAR(64) NOT NULL DEFAULT 'payment',
  metadata               JSONB NOT NULL DEFAULT '{}',
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_transactions_from ON agent_transactions(from_agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_transactions_to   ON agent_transactions(to_agent_id,   created_at DESC);

-- 4. On-chain ReputationRegistry event history
CREATE TABLE IF NOT EXISTS agent_reputation_history (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id          UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  validator_address VARCHAR(66) NOT NULL,
  score             SMALLINT NOT NULL CHECK (score BETWEEN 0 AND 100),
  feedback_type     VARCHAR(40) NOT NULL,
  tag               VARCHAR(40),
  metadata_uri      TEXT,
  evidence_uri      TEXT,
  comment           TEXT,
  feedback_hash     VARCHAR(80),
  tx_hash           VARCHAR(80),
  chain_id          INTEGER NOT NULL DEFAULT 5042002,
  block_number      BIGINT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_reputation_agent ON agent_reputation_history(agent_id, created_at DESC);

-- 5. On-chain ValidationRegistry request/response tracking
CREATE TABLE IF NOT EXISTS agent_validation_requests (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_agent_id   UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  target_agent_id  UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  validator_address VARCHAR(66) NOT NULL,
  request_hash     VARCHAR(80) NOT NULL UNIQUE,
  request_uri      TEXT,
  response_hash    VARCHAR(80),
  response_uri     TEXT,
  response_value   SMALLINT,  -- 100 = pass, 0 = fail
  status           VARCHAR(20) NOT NULL DEFAULT 'pending',
  tag              VARCHAR(40),
  request_tx_hash  VARCHAR(80),
  response_tx_hash VARCHAR(80),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_validation_owner  ON agent_validation_requests(owner_agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_validation_target ON agent_validation_requests(target_agent_id, created_at DESC);
