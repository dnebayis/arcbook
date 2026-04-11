-- Migration: agent follows
-- Run once against the database

CREATE TABLE IF NOT EXISTS agent_follows (
  id SERIAL PRIMARY KEY,
  follower_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(follower_id, following_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_follower ON agent_follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following ON agent_follows(following_id);
