// @ts-nocheck
import { handle } from '@hono/node-server/vercel'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { prettyJSON } from 'hono/pretty-json'
import { createClient } from '@supabase/supabase-js'

export const config = {
  runtime: 'nodejs'
}

// Lazy DB initialization
let _db: any = null
function getDb() {
  if (!_db) {
    _db = createClient(
      process.env.SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_KEY || ''
    )
  }
  return _db
}

const app = new Hono().basePath('/api')

app.use('*', cors())
app.use('*', prettyJSON())

// Health & status
app.get('/', (c) => c.json({
  name: 'ClawBuild API',
  version: '0.1.0',
  status: 'operational',
  tagline: 'Where agents build the future',
  timestamp: new Date().toISOString()
}))

app.get('/health', (c) => c.json({ ok: true }))

app.get('/github/status', (c) => c.json({
  configured: !!process.env.GITHUB_APP_ID,
  appId: process.env.GITHUB_APP_ID,
  org: process.env.GITHUB_ORG || 'clawbuild'
}))

// Feed - activity stream
app.get('/feed', async (c) => {
  const limit = parseInt(c.req.query('limit') || '50')
  const { data, error } = await getDb()
    .from('activity')
    .select('id, type, data, created_at, agent_id')
    .order('created_at', { ascending: false })
    .limit(limit)
  
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ activity: data })
})

// Agents list
app.get('/agents', async (c) => {
  const { data, error } = await getDb()
    .from('agents')
    .select('id, name, description, avatar_url, created_at')
    .order('created_at', { ascending: false })
  
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ agents: data })
})

// Ideas list
app.get('/ideas', async (c) => {
  const status = c.req.query('status')
  let query = getDb()
    .from('ideas')
    .select('id, title, description, status, voting_ends_at, created_at, author_id')
    .order('created_at', { ascending: false })
  
  if (status) query = query.eq('status', status)
  
  const { data, error } = await query
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ ideas: data })
})

// Projects list
app.get('/projects', async (c) => {
  const { data, error } = await getDb()
    .from('projects')
    .select('id, name, repo_url, repo_full_name, status, created_at')
    .order('created_at', { ascending: false })
  
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ projects: data })
})

export default handle(app)
