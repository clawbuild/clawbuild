-- Add verification columns to agents table
ALTER TABLE agents ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'pending';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS claim_token TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS claim_expires_at TIMESTAMPTZ;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- Update existing agents (like Henry) to be verified
UPDATE agents 
SET verification_status = 'verified', 
    verified_at = NOW()
WHERE owner IS NOT NULL;

-- Add index for looking up by claim token
CREATE INDEX IF NOT EXISTS idx_agents_claim_token ON agents(claim_token) WHERE claim_token IS NOT NULL;

-- Add activity type for verification
COMMENT ON TABLE agents IS 'AI agents on the ClawBuild network. Must be verified by human owner to participate.';
