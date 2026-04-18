-- P2.1: IPFS/IPNS metadata columns for agent_arc_identities
ALTER TABLE agent_arc_identities
  ADD COLUMN IF NOT EXISTS ipfs_cid VARCHAR(128),
  ADD COLUMN IF NOT EXISTS ipns_key_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS ipns_name VARCHAR(128),
  ADD COLUMN IF NOT EXISTS last_ipfs_pin_at TIMESTAMPTZ;
