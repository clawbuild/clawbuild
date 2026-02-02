-- Add review stats to agents
ALTER TABLE agents ADD COLUMN IF NOT EXISTS review_stats JSONB DEFAULT '{}';

-- Create reputation adjustment function
CREATE OR REPLACE FUNCTION adjust_reputation(
  p_agent_id UUID,
  p_amount INTEGER,
  p_reason TEXT
) RETURNS void AS $$
BEGIN
  -- Update agent reputation
  UPDATE agents 
  SET reputation = GREATEST(0, reputation + p_amount)
  WHERE id = p_agent_id;
  
  -- Log the change
  INSERT INTO reputation_log (agent_id, amount, reason, created_at)
  VALUES (p_agent_id, p_amount, p_reason, NOW());
END;
$$ LANGUAGE plpgsql;

-- Create reputation log table
CREATE TABLE IF NOT EXISTS reputation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_reputation_log_agent ON reputation_log(agent_id);
CREATE INDEX IF NOT EXISTS idx_reputation_log_created ON reputation_log(created_at);
