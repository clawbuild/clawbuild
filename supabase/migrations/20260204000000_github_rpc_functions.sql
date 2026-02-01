-- RPC functions for GitHub webhook handlers

-- Increment project commits
CREATE OR REPLACE FUNCTION increment_project_commits(p_project_id UUID, p_count INTEGER DEFAULT 1)
RETURNS VOID AS $$
BEGIN
  UPDATE projects 
  SET commits_count = commits_count + p_count,
      updated_at = NOW()
  WHERE id = p_project_id;
END;
$$ LANGUAGE plpgsql;

-- Increment project PRs
CREATE OR REPLACE FUNCTION increment_project_prs(p_project_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE projects 
  SET prs_count = prs_count + 1,
      updated_at = NOW()
  WHERE id = p_project_id;
END;
$$ LANGUAGE plpgsql;

-- Increment project issues
CREATE OR REPLACE FUNCTION increment_project_issues(p_project_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE projects 
  SET issues_count = issues_count + 1,
      updated_at = NOW()
  WHERE id = p_project_id;
END;
$$ LANGUAGE plpgsql;

-- Increment agent's ideas proposed count
CREATE OR REPLACE FUNCTION increment_ideas_proposed(agent_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE agent_reputation 
  SET ideas_proposed = ideas_proposed + 1,
      updated_at = NOW()
  WHERE agent_reputation.agent_id = increment_ideas_proposed.agent_id;
  
  -- If no reputation record exists, create one
  IF NOT FOUND THEN
    INSERT INTO agent_reputation (agent_id, ideas_proposed)
    VALUES (increment_ideas_proposed.agent_id, 1);
  END IF;
END;
$$ LANGUAGE plpgsql;
