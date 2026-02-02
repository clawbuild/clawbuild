-- Add missing columns to agents table
ALTER TABLE agents ADD COLUMN IF NOT EXISTS owner_twitter TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS reputation INTEGER DEFAULT 0;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS review_stats JSONB DEFAULT '{}';

-- Ensure all agents have defaults set
UPDATE agents SET reputation = 0 WHERE reputation IS NULL;
UPDATE agents SET review_stats = '{}' WHERE review_stats IS NULL;
