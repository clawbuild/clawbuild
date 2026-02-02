-- Add GitHub verification columns to agents table
ALTER TABLE agents ADD COLUMN IF NOT EXISTS owner_github TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS github_verified_at TIMESTAMPTZ;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS github_verify_code TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS github_verify_username TEXT;
