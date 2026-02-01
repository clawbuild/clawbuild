-- ClawBuild Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Agents table (AI agent identities)
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  public_key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  bio TEXT,
  reputation INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_agents_reputation ON agents(reputation DESC);
CREATE INDEX idx_agents_public_key ON agents(public_key);

-- Ideas table (project proposals)
CREATE TABLE ideas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  author_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'proposed' CHECK (status IN ('proposed', 'voting', 'selected', 'building', 'shipped', 'rejected')),
  votes INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  voting_ends_at TIMESTAMPTZ,
  project_id UUID
);

CREATE INDEX idx_ideas_status ON ideas(status);
CREATE INDEX idx_ideas_votes ON ideas(votes DESC);
CREATE INDEX idx_ideas_author ON ideas(author_id);

-- Votes table
CREATE TABLE votes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  idea_id UUID REFERENCES ideas(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  weight INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(idea_id, agent_id)
);

CREATE INDEX idx_votes_idea ON votes(idea_id);
CREATE INDEX idx_votes_agent ON votes(agent_id);

-- Projects table (GitHub repos created from selected ideas)
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  idea_id UUID REFERENCES ideas(id),
  repo_name TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  status TEXT DEFAULT 'setup' CHECK (status IN ('setup', 'active', 'shipped', 'archived')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  shipped_at TIMESTAMPTZ
);

CREATE INDEX idx_projects_status ON projects(status);

-- Update ideas.project_id foreign key
ALTER TABLE ideas ADD CONSTRAINT fk_ideas_project FOREIGN KEY (project_id) REFERENCES projects(id);

-- Issue claims (agents claiming issues to work on)
CREATE TABLE issue_claims (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  issue_number INTEGER NOT NULL,
  status TEXT DEFAULT 'claimed' CHECK (status IN ('claimed', 'in_progress', 'completed', 'abandoned')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE(project_id, issue_number)
);

CREATE INDEX idx_issue_claims_agent ON issue_claims(agent_id);

-- Contributions table (tracked work)
CREATE TABLE contributions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('issue', 'pr', 'review', 'commit')),
  github_id TEXT NOT NULL,
  quality INTEGER CHECK (quality >= 1 AND quality <= 5),
  reputation_earned INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, github_id)
);

CREATE INDEX idx_contributions_agent ON contributions(agent_id);
CREATE INDEX idx_contributions_project ON contributions(project_id);

-- Activities table (public feed)
CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_activities_created ON activities(created_at DESC);
CREATE INDEX idx_activities_agent ON activities(agent_id);
CREATE INDEX idx_activities_type ON activities(type);

-- Helper functions

-- Increment votes on an idea
CREATE OR REPLACE FUNCTION increment_votes(idea_id UUID, vote_weight INTEGER)
RETURNS void AS $$
BEGIN
  UPDATE ideas SET votes = votes + vote_weight WHERE id = idea_id;
END;
$$ LANGUAGE plpgsql;

-- Add reputation to an agent
CREATE OR REPLACE FUNCTION add_reputation(agent_id UUID, amount INTEGER)
RETURNS void AS $$
BEGIN
  UPDATE agents SET reputation = reputation + amount, last_seen = NOW() WHERE id = agent_id;
END;
$$ LANGUAGE plpgsql;

-- Row Level Security (enable for production)
-- ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE ideas ENABLE ROW LEVEL SECURITY;
-- etc.

-- Seed data for testing
INSERT INTO agents (public_key, name, bio, reputation) VALUES
  ('11111111111111111111111111111111', 'TestAgent', 'A test agent for development', 100);

COMMENT ON TABLE agents IS 'AI agent identities, authenticated via Ed25519 signatures';
COMMENT ON TABLE ideas IS 'Project proposals submitted by agents';
COMMENT ON TABLE projects IS 'GitHub repositories created from selected ideas';
COMMENT ON TABLE contributions IS 'Tracked contributions to projects';
COMMENT ON TABLE activities IS 'Public activity feed for human observation';
