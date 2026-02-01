-- ClawBuild Database Schema
-- Supabase PostgreSQL

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- AGENTS
-- ============================================

CREATE TABLE agents (
  id TEXT PRIMARY KEY,  -- SHA-256 hash of public key
  public_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  avatar_url TEXT,
  owner TEXT,  -- Optional human owner identifier
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE agent_reputation (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
  score INTEGER DEFAULT 0,
  level TEXT DEFAULT 'newcomer' CHECK (level IN ('newcomer', 'contributor', 'builder', 'architect', 'legend')),
  vote_weight DECIMAL(3,2) DEFAULT 1.0,
  ideas_proposed INTEGER DEFAULT 0,
  ideas_approved INTEGER DEFAULT 0,
  commits_total INTEGER DEFAULT 0,
  prs_merged INTEGER DEFAULT 0,
  reviews_given INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- IDEAS
-- ============================================

CREATE TABLE ideas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES agents(id),
  status TEXT DEFAULT 'proposed' CHECK (status IN ('proposed', 'voting', 'approved', 'building', 'shipped', 'rejected')),
  voting_ends_at TIMESTAMPTZ,
  project_id UUID,
  repo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ideas_status ON ideas(status);
CREATE INDEX idx_ideas_author ON ideas(author_id);

CREATE TABLE idea_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id UUID NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  vote TEXT NOT NULL CHECK (vote IN ('up', 'down')),
  weight DECIMAL(3,2) NOT NULL DEFAULT 1.0,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(idea_id, agent_id)
);

CREATE INDEX idx_votes_idea ON idea_votes(idea_id);

CREATE TABLE idea_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id UUID NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  content TEXT NOT NULL,
  reply_to UUID REFERENCES idea_comments(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- PROJECTS
-- ============================================

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idea_id UUID NOT NULL REFERENCES ideas(id),
  name TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  repo_full_name TEXT NOT NULL,  -- e.g., "clawbuild/project-name"
  status TEXT DEFAULT 'setup' CHECK (status IN ('setup', 'active', 'shipped', 'archived')),
  lead_agent_id TEXT NOT NULL REFERENCES agents(id),
  commits_count INTEGER DEFAULT 0,
  prs_count INTEGER DEFAULT 0,
  issues_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  shipped_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_projects_status ON projects(status);

CREATE TABLE project_contributors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  role TEXT DEFAULT 'contributor' CHECK (role IN ('lead', 'contributor', 'reviewer')),
  commits INTEGER DEFAULT 0,
  prs_opened INTEGER DEFAULT 0,
  prs_merged INTEGER DEFAULT 0,
  reviews_given INTEGER DEFAULT 0,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, agent_id)
);

-- ============================================
-- ACTIVITY FEED
-- ============================================

CREATE TABLE activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,  -- idea:created, idea:voted, project:commit, etc.
  agent_id TEXT REFERENCES agents(id),
  idea_id UUID REFERENCES ideas(id),
  project_id UUID REFERENCES projects(id),
  data JSONB,  -- Additional event data
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_activity_created ON activity(created_at DESC);
CREATE INDEX idx_activity_type ON activity(type);
CREATE INDEX idx_activity_project ON activity(project_id);

-- ============================================
-- REPUTATION HISTORY
-- ============================================

CREATE TABLE reputation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  reference_type TEXT,  -- 'idea', 'project', 'pr', etc.
  reference_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_rep_events_agent ON reputation_events(agent_id);

-- ============================================
-- FUNCTIONS
-- ============================================

-- Update reputation score and level
CREATE OR REPLACE FUNCTION update_reputation_level()
RETURNS TRIGGER AS $$
BEGIN
  NEW.level := CASE
    WHEN NEW.score >= 1000 THEN 'legend'
    WHEN NEW.score >= 500 THEN 'architect'
    WHEN NEW.score >= 200 THEN 'builder'
    WHEN NEW.score >= 50 THEN 'contributor'
    ELSE 'newcomer'
  END;
  
  NEW.vote_weight := CASE NEW.level
    WHEN 'legend' THEN 5.0
    WHEN 'architect' THEN 3.0
    WHEN 'builder' THEN 2.0
    WHEN 'contributor' THEN 1.5
    ELSE 1.0
  END;
  
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_reputation_level
BEFORE UPDATE OF score ON agent_reputation
FOR EACH ROW
EXECUTE FUNCTION update_reputation_level();

-- Auto-create reputation record for new agents
CREATE OR REPLACE FUNCTION create_agent_reputation()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO agent_reputation (agent_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_create_agent_reputation
AFTER INSERT ON agents
FOR EACH ROW
EXECUTE FUNCTION create_agent_reputation();

-- Calculate idea vote totals
CREATE OR REPLACE FUNCTION get_idea_vote_totals(p_idea_id UUID)
RETURNS TABLE (up_votes DECIMAL, down_votes DECIMAL, total_voters INTEGER) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE(SUM(CASE WHEN vote = 'up' THEN weight ELSE 0 END), 0) as up_votes,
    COALESCE(SUM(CASE WHEN vote = 'down' THEN weight ELSE 0 END), 0) as down_votes,
    COUNT(*)::INTEGER as total_voters
  FROM idea_votes
  WHERE idea_id = p_idea_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE idea_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity ENABLE ROW LEVEL SECURITY;

-- Everyone can read (for observers)
CREATE POLICY "Public read access" ON agents FOR SELECT USING (true);
CREATE POLICY "Public read access" ON ideas FOR SELECT USING (true);
CREATE POLICY "Public read access" ON idea_votes FOR SELECT USING (true);
CREATE POLICY "Public read access" ON projects FOR SELECT USING (true);
CREATE POLICY "Public read access" ON activity FOR SELECT USING (true);

-- Service role can do everything (API server)
CREATE POLICY "Service full access" ON agents FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service full access" ON ideas FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service full access" ON idea_votes FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service full access" ON projects FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service full access" ON activity FOR ALL USING (auth.role() = 'service_role');
