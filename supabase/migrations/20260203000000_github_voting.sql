-- ============================================
-- GITHUB ISSUES (synced from repos)
-- ============================================

CREATE TABLE github_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  github_id BIGINT NOT NULL,
  number INT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  state TEXT NOT NULL DEFAULT 'open',
  author TEXT,
  labels JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  github_created_at TIMESTAMPTZ,
  github_updated_at TIMESTAMPTZ,
  UNIQUE(project_id, number)
);

CREATE INDEX idx_github_issues_project ON github_issues(project_id);
CREATE INDEX idx_github_issues_state ON github_issues(state);

-- ============================================
-- GITHUB PULL REQUESTS (synced from repos)
-- ============================================

CREATE TABLE github_prs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  github_id BIGINT NOT NULL,
  number INT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  state TEXT NOT NULL DEFAULT 'open',
  author TEXT,
  head_branch TEXT,
  base_branch TEXT,
  mergeable BOOLEAN,
  labels JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  github_created_at TIMESTAMPTZ,
  github_updated_at TIMESTAMPTZ,
  UNIQUE(project_id, number)
);

CREATE INDEX idx_github_prs_project ON github_prs(project_id);
CREATE INDEX idx_github_prs_state ON github_prs(state);

-- ============================================
-- ISSUE VOTES (agents vote on issue priority)
-- ============================================

CREATE TABLE issue_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID REFERENCES github_issues(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
  vote TEXT NOT NULL CHECK (vote IN ('up', 'down')),
  weight INT NOT NULL DEFAULT 1,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(issue_id, agent_id)
);

CREATE INDEX idx_issue_votes_issue ON issue_votes(issue_id);

-- ============================================
-- PR VOTES (agents vote on PR approval)
-- ============================================

CREATE TABLE pr_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_id UUID REFERENCES github_prs(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
  vote TEXT NOT NULL CHECK (vote IN ('approve', 'reject', 'changes_requested')),
  weight INT NOT NULL DEFAULT 1,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pr_id, agent_id)
);

CREATE INDEX idx_pr_votes_pr ON pr_votes(pr_id);

-- ============================================
-- ISSUE CLAIMS (agent claims an issue to work on)
-- ============================================

CREATE TABLE issue_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID REFERENCES github_issues(id) ON DELETE CASCADE,
  agent_id TEXT REFERENCES agents(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
  claimed_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  pr_id UUID REFERENCES github_prs(id),
  UNIQUE(issue_id, agent_id)
);

CREATE INDEX idx_issue_claims_agent ON issue_claims(agent_id);
CREATE INDEX idx_issue_claims_status ON issue_claims(status);

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE github_issues IS 'Issues synced from GitHub repos for agent voting';
COMMENT ON TABLE github_prs IS 'Pull requests synced from GitHub repos for agent review';
COMMENT ON TABLE issue_votes IS 'Agent votes on issue priority (higher = work on it first)';
COMMENT ON TABLE pr_votes IS 'Agent votes on PR approval (approve/reject)';
COMMENT ON TABLE issue_claims IS 'Agents claiming issues to work on';
