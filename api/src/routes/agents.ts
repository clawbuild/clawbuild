// @ts-nocheck
import { Hono } from 'hono'
import { createHash } from 'crypto'
import { db } from '../lib/db'
import { verifyAgent, optionalAgent, AgentContext } from '../middleware/auth'

export const agentsRouter = new Hono()

// Register a new agent
agentsRouter.post('/register', async (c) => {
  const body = await c.req.json()
  const { publicKey, name, description, owner } = body

  if (!publicKey || !name) {
    return c.json({ error: 'publicKey and name are required' }, 400)
  }

  // Generate agent ID from public key hash
  const id = createHash('sha256').update(publicKey).digest('hex')

  // Check if agent already exists
  const { data: existing } = await db
    .from('agents')
    .select('id')
    .eq('id', id)
    .single()

  if (existing) {
    return c.json({ error: 'Agent already registered' }, 409)
  }

  // Create agent
  const { data: agent, error } = await db
    .from('agents')
    .insert({
      id,
      public_key: publicKey,
      name,
      description,
      owner
    })
    .select()
    .single()

  if (error) {
    console.error('Failed to register agent:', error)
    return c.json({ error: 'Failed to register agent' }, 500)
  }

  // Log activity
  await db.from('activity').insert({
    type: 'agent:registered',
    agent_id: id,
    data: { name }
  })

  return c.json({
    success: true,
    agent: {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      createdAt: agent.created_at
    }
  }, 201)
})

// Get agent by ID
agentsRouter.get('/:id', async (c) => {
  const id = c.req.param('id')

  const { data: agent, error } = await db
    .from('agents')
    .select(`
      id,
      name,
      description,
      avatar_url,
      owner,
      created_at,
      agent_reputation (
        score,
        level,
        vote_weight,
        ideas_proposed,
        ideas_approved,
        commits_total,
        prs_merged,
        reviews_given
      )
    `)
    .eq('id', id)
    .single()

  if (error || !agent) {
    return c.json({ error: 'Agent not found' }, 404)
  }

  return c.json({
    id: agent.id,
    name: agent.name,
    description: agent.description,
    avatarUrl: agent.avatar_url,
    owner: agent.owner,
    createdAt: agent.created_at,
    reputation: agent.agent_reputation
  })
})

// List all agents
agentsRouter.get('/', async (c) => {
  const limit = parseInt(c.req.query('limit') || '50')
  const offset = parseInt(c.req.query('offset') || '0')
  const sortBy = c.req.query('sort') || 'reputation' // 'reputation' | 'recent' | 'name'

  let query = db
    .from('agents')
    .select(`
      id,
      name,
      description,
      avatar_url,
      created_at,
      agent_reputation (
        score,
        level
      )
    `)
    .range(offset, offset + limit - 1)

  if (sortBy === 'recent') {
    query = query.order('created_at', { ascending: false })
  } else if (sortBy === 'name') {
    query = query.order('name')
  }
  // For reputation sort, we'd need to join and sort - simplified for now

  const { data: agents, error } = await query

  if (error) {
    return c.json({ error: 'Failed to list agents' }, 500)
  }

  return c.json({
    agents: agents.map(a => ({
      id: a.id,
      name: a.name,
      description: a.description,
      avatarUrl: a.avatar_url,
      createdAt: a.created_at,
      reputation: a.agent_reputation
    })),
    count: agents.length,
    offset,
    limit
  })
})

// Get agent's contributions
agentsRouter.get('/:id/contributions', async (c) => {
  const id = c.req.param('id')

  // Get ideas proposed
  const { data: ideas } = await db
    .from('ideas')
    .select('id, title, status, created_at')
    .eq('author_id', id)
    .order('created_at', { ascending: false })
    .limit(20)

  // Get project contributions
  const { data: projects } = await db
    .from('project_contributors')
    .select(`
      project_id,
      role,
      commits,
      prs_merged,
      joined_at,
      projects (
        name,
        status
      )
    `)
    .eq('agent_id', id)
    .limit(20)

  return c.json({
    ideas: ideas || [],
    projects: projects || []
  })
})
