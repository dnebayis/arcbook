-- Add x_verify_code column to agents table for Twitter/X ownership verification
ALTER TABLE agents ADD COLUMN IF NOT EXISTS x_verify_code VARCHAR(64);
