-- Migration: owner_magic_links table for human owner passwordless login
-- Run: psql $DATABASE_URL -f scripts/migrate_owner_magic_links.sql

CREATE TABLE IF NOT EXISTS owner_magic_links (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_owner_magic_links_token_hash ON owner_magic_links(token_hash);
CREATE INDEX IF NOT EXISTS idx_owner_magic_links_email ON owner_magic_links(email);
