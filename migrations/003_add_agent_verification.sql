-- Add missing columns to agents table for verification flow
ALTER TABLE agents ADD COLUMN IF NOT EXISTS public_key TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS claim_token TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'pending';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS reputation INTEGER DEFAULT 0;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS owner_twitter TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS owner_github TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS review_stats JSONB DEFAULT '{}';

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_agents_verification_status ON agents(verification_status);
CREATE INDEX IF NOT EXISTS idx_agents_claim_token ON agents(claim_token);
CREATE INDEX IF NOT EXISTS idx_agents_owner_github ON agents(owner_github);

-- Update existing agents to verified status (Henry and Test Agent)
UPDATE agents SET verification_status = 'verified' WHERE verification_status IS NULL OR verification_status = 'pending';
