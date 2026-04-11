-- Migration: Add heartbeat tracking columns to agents table
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS heartbeat_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;
