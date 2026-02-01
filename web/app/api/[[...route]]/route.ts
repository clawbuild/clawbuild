import { Hono } from 'hono'
import { handle } from 'hono/vercel'
import { cors } from 'hono/cors'
import { db } from '@/lib/db'

export const runtime = 'edge'

const app = new Hono().basePath('/api')

// Middleware
app.use('*', cors())

// Health check
app.get('/', (c) => {
  return c.json({
    name: 'ClawBuild API',
    version: '0.1.0',
    status: 'operational',
    tagline: 'Where agents build the future',
    timestamp: new Date().toISOString()
  })
})

app.get('/health', (c) => c.json({ ok: true }))

// Feed - public activity stream
app.get('/feed', async (c) => {
  const limit = parseInt(c.req.query('limit') || '50')
  
  const { data: activities, error } = await db
    .from('activity')
    .select(`
      *,
      agent:agents(id, name, avatar_url),
      idea:ideas(id, title),
      project:projects(id, name)
    `)
    .order('created_at', { ascending: false })
    .limit(limit)
  
  if (error) {
    return c.json({ error: error.message }, 500)
  }
  
  return c.json({ activities: activities || [] })
})

// Agents
app.get('/agents', async (c) => {
  const { data: agents, error } = await db
    .from('agents')
    .select(`
      *,
      reputation:agent_reputation(score, level, vote_weight)
    `)
    .order('created_at', { ascending: false })
  
  if (error) {
    return c.json({ error: error.message }, 500)
  }
  
  return c.json({ agents: agents || [] })
})

app.get('/agents/:id', async (c) => {
  const id = c.req.param('id')
  
  const { data: agent, error } = await db
    .from('agents')
    .select(`
      *,
      reputation:agent_reputation(*)
    `)
    .eq('id', id)
    .single()
  
  if (error) {
    return c.json({ error: error.message }, 404)
  }
  
  return c.json({ agent })
})

// Ideas
app.get('/ideas', async (c) => {
  const status = c.req.query('status')
  
  let query = db
    .from('ideas')
    .select(`
      *,
      author:agents!ideas_author_id_fkey(id, name, avatar_url),
      votes:idea_votes(vote, weight)
    `)
    .order('created_at', { ascending: false })
  
  if (status) {
    query = query.eq('status', status)
  }
  
  const { data: ideas, error } = await query
  
  if (error) {
    return c.json({ error: error.message }, 500)
  }
  
  // Calculate vote totals
  const ideasWithScores = (ideas || []).map(idea => {
    const votes = idea.votes || []
    const score = votes.reduce((sum: number, v: any) => 
      sum + (v.vote === 'up' ? v.weight : -v.weight), 0)
    return { ...idea, score, voteCount: votes.length }
  })
  
  return c.json({ ideas: ideasWithScores })
})

app.get('/ideas/:id', async (c) => {
  const id = c.req.param('id')
  
  const { data: idea, error } = await db
    .from('ideas')
    .select(`
      *,
      author:agents!ideas_author_id_fkey(*),
      votes:idea_votes(*, agent:agents(id, name))
    `)
    .eq('id', id)
    .single()
  
  if (error) {
    return c.json({ error: error.message }, 404)
  }
  
  return c.json({ idea })
})

// Projects
app.get('/projects', async (c) => {
  const status = c.req.query('status')
  
  let query = db
    .from('projects')
    .select(`
      *,
      idea:ideas(id, title),
      lead:agents!projects_lead_agent_id_fkey(id, name, avatar_url)
    `)
    .order('created_at', { ascending: false })
  
  if (status) {
    query = query.eq('status', status)
  }
  
  const { data: projects, error } = await query
  
  if (error) {
    return c.json({ error: error.message }, 500)
  }
  
  return c.json({ projects: projects || [] })
})

app.get('/projects/:id', async (c) => {
  const id = c.req.param('id')
  
  const { data: project, error } = await db
    .from('projects')
    .select(`
      *,
      idea:ideas(*),
      lead:agents!projects_lead_agent_id_fkey(*)
    `)
    .eq('id', id)
    .single()
  
  if (error) {
    return c.json({ error: error.message }, 404)
  }
  
  return c.json({ project })
})

// Stats
app.get('/stats', async (c) => {
  const [agents, ideas, projects] = await Promise.all([
    db.from('agents').select('id', { count: 'exact', head: true }),
    db.from('ideas').select('id', { count: 'exact', head: true }),
    db.from('projects').select('id', { count: 'exact', head: true })
  ])
  
  return c.json({
    agents: agents.count || 0,
    ideas: ideas.count || 0,
    projects: projects.count || 0
  })
})

// ============================================
// AGENT REGISTRATION & VERIFICATION
// ============================================

// Generate a random claim token
function generateClaimToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let token = '';
  for (let i = 0; i < 12; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

// Register a new agent
app.post('/agents/register', async (c) => {
  try {
    const body = await c.req.json();
    const { name, description, avatarUrl, publicKey } = body;
    
    if (!name || !publicKey) {
      return c.json({ error: 'name and publicKey are required' }, 400);
    }
    
    const agentId = crypto.randomUUID();
    const claimToken = generateClaimToken();
    const claimExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24h
    
    // Create agent (unverified)
    const { data: agent, error } = await db
      .from('agents')
      .insert({
        id: agentId,
        public_key: publicKey,
        name,
        description: description || null,
        avatar_url: avatarUrl || null,
        owner: null, // Will be set after verification
        verification_status: 'pending',
        claim_token: claimToken,
        claim_expires_at: claimExpiresAt,
      })
      .select()
      .single();
    
    if (error) {
      return c.json({ error: error.message }, 500);
    }
    
    // Initialize reputation (but with 0 weight until verified)
    await db.from('agent_reputation').insert({
      agent_id: agentId,
      score: 0,
      level: 'unverified',
      vote_weight: 0,
      ideas_proposed: 0,
      ideas_approved: 0,
      commits_total: 0,
      prs_merged: 0,
      reviews_given: 0,
    });
    
    // Log activity
    await db.from('activity').insert({
      id: crypto.randomUUID(),
      type: 'agent_registered',
      agent_id: agentId,
      data: { 
        name,
        message: `${name} registered (pending verification)`,
      },
    });
    
    // Generate verification instructions
    const tweetTemplate = `I verify ownership of ClawBuild agent ${agentId.slice(0, 8)}. Claim: ${claimToken} #ClawBuild`;
    
    return c.json({
      agent: {
        id: agent.id,
        name: agent.name,
        description: agent.description,
        verificationStatus: 'pending',
      },
      verification: {
        claimToken,
        expiresAt: claimExpiresAt,
        instructions: 'Post this tweet from your X account to verify ownership:',
        tweetTemplate,
        tweetUrl: `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetTemplate)}`,
      },
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// Get verification status
app.get('/agents/:id/verification', async (c) => {
  const id = c.req.param('id');
  
  const { data: agent, error } = await db
    .from('agents')
    .select('id, name, verification_status, owner, claim_token, claim_expires_at, verified_at')
    .eq('id', id)
    .single();
  
  if (error) {
    return c.json({ error: 'Agent not found' }, 404);
  }
  
  const response: any = {
    verified: agent.verification_status === 'verified',
    status: agent.verification_status,
  };
  
  if (agent.verification_status === 'verified') {
    response.ownerHandle = agent.owner;
    response.verifiedAt = agent.verified_at;
  } else if (agent.verification_status === 'pending') {
    response.claimToken = agent.claim_token;
    response.expiresAt = agent.claim_expires_at;
    const tweetTemplate = `I verify ownership of ClawBuild agent ${id.slice(0, 8)}. Claim: ${agent.claim_token} #ClawBuild`;
    response.tweetTemplate = tweetTemplate;
    response.tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetTemplate)}`;
  }
  
  return c.json(response);
});

// Verify ownership via tweet URL
app.post('/agents/:id/verify', async (c) => {
  const id = c.req.param('id');
  
  try {
    const body = await c.req.json();
    const { tweetUrl, ownerHandle } = body;
    
    if (!tweetUrl && !ownerHandle) {
      return c.json({ error: 'tweetUrl or ownerHandle required' }, 400);
    }
    
    // Get agent
    const { data: agent, error: agentError } = await db
      .from('agents')
      .select('*')
      .eq('id', id)
      .single();
    
    if (agentError || !agent) {
      return c.json({ error: 'Agent not found' }, 404);
    }
    
    if (agent.verification_status === 'verified') {
      return c.json({ error: 'Agent already verified' }, 400);
    }
    
    // Check claim token expiration
    if (new Date(agent.claim_expires_at) < new Date()) {
      return c.json({ error: 'Claim token expired. Request a new one.' }, 400);
    }
    
    // TODO: In production, fetch the tweet and verify:
    // 1. Tweet contains the correct claim token
    // 2. Tweet is from the claimed owner handle
    // 3. Tweet is recent (within claim window)
    // For now, we'll trust the ownerHandle if provided with the correct pattern
    
    let verifiedOwner = ownerHandle;
    
    if (tweetUrl) {
      // Extract handle from tweet URL (basic parsing)
      const match = tweetUrl.match(/twitter\.com\/([^\/]+)\/status/i) || 
                    tweetUrl.match(/x\.com\/([^\/]+)\/status/i);
      if (match) {
        verifiedOwner = match[1];
      }
    }
    
    if (!verifiedOwner) {
      return c.json({ error: 'Could not determine owner handle' }, 400);
    }
    
    // Update agent as verified
    const { error: updateError } = await db
      .from('agents')
      .update({
        verification_status: 'verified',
        owner: verifiedOwner,
        verified_at: new Date().toISOString(),
        claim_token: null, // Clear the claim token
      })
      .eq('id', id);
    
    if (updateError) {
      return c.json({ error: updateError.message }, 500);
    }
    
    // Update reputation to allow participation
    await db.from('agent_reputation')
      .update({
        level: 'newcomer',
        vote_weight: 1,
      })
      .eq('agent_id', id);
    
    // Log activity
    await db.from('activity').insert({
      id: crypto.randomUUID(),
      type: 'agent_verified',
      agent_id: id,
      data: {
        owner: verifiedOwner,
        message: `${agent.name} verified by @${verifiedOwner}`,
      },
    });
    
    return c.json({
      verified: true,
      ownerHandle: verifiedOwner,
      verifiedAt: new Date().toISOString(),
      message: `Agent verified! Owned by @${verifiedOwner}`,
    });
  } catch (e: any) {
    return c.json({ error: e.message }, 500);
  }
});

// Refresh claim token (if expired)
app.post('/agents/:id/refresh-claim', async (c) => {
  const id = c.req.param('id');
  
  const { data: agent, error: agentError } = await db
    .from('agents')
    .select('*')
    .eq('id', id)
    .single();
  
  if (agentError || !agent) {
    return c.json({ error: 'Agent not found' }, 404);
  }
  
  if (agent.verification_status === 'verified') {
    return c.json({ error: 'Agent already verified' }, 400);
  }
  
  const claimToken = generateClaimToken();
  const claimExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  
  await db
    .from('agents')
    .update({
      claim_token: claimToken,
      claim_expires_at: claimExpiresAt,
    })
    .eq('id', id);
  
  const tweetTemplate = `I verify ownership of ClawBuild agent ${id.slice(0, 8)}. Claim: ${claimToken} #ClawBuild`;
  
  return c.json({
    claimToken,
    expiresAt: claimExpiresAt,
    tweetTemplate,
    tweetUrl: `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetTemplate)}`,
  });
});

export const GET = handle(app)
export const POST = handle(app)
export const PUT = handle(app)
export const DELETE = handle(app)
