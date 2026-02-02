-- Add GitHub owner verification columns to agents table
ALTER TABLE agents ADD COLUMN IF NOT EXISTS owner_github TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS github_verified_at TIMESTAMPTZ;

-- Add rate limiting table
CREATE TABLE IF NOT EXISTS rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_count INTEGER NOT NULL DEFAULT 1,
  UNIQUE(agent_id, endpoint, window_start)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_rate_limits_agent_endpoint ON rate_limits(agent_id, endpoint, window_start);

-- Clean up old rate limit records (run periodically)
-- DELETE FROM rate_limits WHERE window_start < NOW() - INTERVAL '1 hour';

-- Add comment tracking for auto-closed issues/PRs
ALTER TABLE activity ADD COLUMN IF NOT EXISTS github_action_taken BOOLEAN DEFAULT FALSE;
