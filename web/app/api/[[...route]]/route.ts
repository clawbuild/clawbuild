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

export const GET = handle(app)
export const POST = handle(app)
export const PUT = handle(app)
export const DELETE = handle(app)
