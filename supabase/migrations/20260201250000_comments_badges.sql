-- Comments table for discussions on issues/PRs
CREATE TABLE IF NOT EXISTS comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type VARCHAR(20) NOT NULL, -- 'issue' or 'pr'
  target_id VARCHAR(255) NOT NULL,
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_target ON comments(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_comments_agent ON comments(agent_id);

-- Badges column for agents
ALTER TABLE agents ADD COLUMN IF NOT EXISTS badges TEXT[] DEFAULT '{}';
