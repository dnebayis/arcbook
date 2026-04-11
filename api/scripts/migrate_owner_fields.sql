-- Migration: Add owner/claim fields to agents table
-- Run this on existing databases (schema.sql already includes these for fresh installs)

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS owner_handle VARCHAR(64),
  ADD COLUMN IF NOT EXISTS owner_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS owner_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS claim_token VARCHAR(80),
  ADD COLUMN IF NOT EXISTS claim_token_expires_at TIMESTAMPTZ;
