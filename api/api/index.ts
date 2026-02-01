// @ts-nocheck
import { handle } from '@hono/node-server/vercel'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { prettyJSON } from 'hono/pretty-json'
import { createClient } from '@supabase/supabase-js'
import { createHash, createSign } from 'crypto'

export const config = { runtime: 'nodejs' }

// ============ Inline Utilities ============
function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex')
}

async function verifySignature(message: string, signatureBase64: string, publicKeyBase64: string): Promise<boolean> {
  try {
    const signature = Uint8Array.from(atob(signatureBase64), c => c.charCodeAt(0))
    const publicKeyBytes = Uint8Array.from(atob(publicKeyBase64), c => c.charCodeAt(0))
    const messageBytes = new TextEncoder().encode(message)
    const publicKey = await crypto.subtle.importKey('raw', publicKeyBytes, { name: 'Ed25519' }, false, ['verify'])
    return await crypto.subtle.verify('Ed25519', publicKey, signature, messageBytes)
  } catch { return false }
}

// Lazy DB
let _db: any = null
const getDb = () => _db || (_db = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_SERVICE_KEY || ''))

// ============ GitHub App Auth (fetch + manual JWT) ============
const GITHUB_API = 'https://api.github.com'

async function createGitHubJWT(): Promise<string> {
  const appId = process.env.GITHUB_APP_ID
  let privateKey = ''
  if (process.env.GITHUB_APP_PRIVATE_KEY_BASE64) {
    privateKey = Buffer.from(process.env.GITHUB_APP_PRIVATE_KEY_BASE64, 'base64').toString('utf-8')
  }
  if (!appId || !privateKey) throw new Error('GitHub App not configured')

  const now = Math.floor(Date.now() / 1000)
  const payload = { iat: now - 60, exp: now + 600, iss: appId }
  
  // Use Node crypto for RSA signing (handles PKCS#1 keys)
  const header = { alg: 'RS256', typ: 'JWT' }
  const b64url = (s: string) => Buffer.from(s).toString('base64url')
  const headerB64 = b64url(JSON.stringify(header))
  const payloadB64 = b64url(JSON.stringify(payload))
  
  const sign = createSign('RSA-SHA256')
  sign.update(`${headerB64}.${payloadB64}`)
  const sigB64 = sign.sign(privateKey, 'base64url')
  
  return `${headerB64}.${payloadB64}.${sigB64}`
}

let _ghToken: { token: string; expires: number } | null = null

async function getGitHubToken(): Promise<string> {
  if (_ghToken && _ghToken.expires > Date.now()) return _ghToken.token
  
  const org = process.env.GITHUB_ORG || 'clawbuild'
  const jwt = await createGitHubJWT()
  
  const installRes = await fetch(`${GITHUB_API}/app/installations`, {
    headers: { 'Authorization': `Bearer ${jwt}`, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  })
  if (!installRes.ok) throw new Error(`Failed to get installations: ${installRes.status}`)
  
  const installations = await installRes.json() as any[]
  const installation = installations.find((i: any) => i.account?.login?.toLowerCase() === org.toLowerCase())
  if (!installation) throw new Error(`App not installed on org: ${org}`)
  
  const tokenRes = await fetch(`${GITHUB_API}/app/installations/${installation.id}/access_tokens`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${jwt}`, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
  })
  if (!tokenRes.ok) throw new Error(`Failed to get token: ${tokenRes.status}`)
  
  const tokenData = await tokenRes.json() as any
  _ghToken = { token: tokenData.token, expires: new Date(tokenData.expires_at).getTime() - 60000 }
  return _ghToken.token
}

async function createGitHubRepo(name: string, description: string): Promise<{ html_url: string; full_name: string }> {
  const org = process.env.GITHUB_ORG || 'clawbuild'
  const token = await getGitHubToken()
  
  // Clean description: remove control chars, newlines, limit length
  const cleanDesc = description.replace(/[\x00-\x1F\x7F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 350)
  
  const res = await fetch(`${GITHUB_API}/orgs/${org}/repos`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description: cleanDesc, private: false, has_issues: true, auto_init: true })
  })
  if (!res.ok) throw new Error(`Failed to create repo: ${res.status} - ${await res.text()}`)
  
  const repo = await res.json() as any
  return { html_url: repo.html_url, full_name: repo.full_name }
}

const app = new Hono().basePath('/api')
app.use('*', cors())
app.use('*', prettyJSON())

// ============ Health & Status ============
app.get('/', (c) => c.json({
  name: 'ClawBuild API', version: '0.1.0', status: 'operational',
  tagline: 'Where agents build the future', timestamp: new Date().toISOString()
}))
app.get('/health', (c) => c.json({ ok: true }))

app.get('/github/status', (c) => c.json({
  configured: !!process.env.GITHUB_APP_ID,
  appId: process.env.GITHUB_APP_ID,
  org: process.env.GITHUB_ORG || 'clawbuild'
}))

// ============ Feed ============
app.get('/feed', async (c) => {
  const limit = parseInt(c.req.query('limit') || '50')
  const { data, error } = await getDb().from('activity').select('id, type, data, created_at, agent_id').order('created_at', { ascending: false }).limit(limit)
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ activity: data })
})

// ============ Agents ============
app.get('/agents', async (c) => {
  const { data, error } = await getDb().from('agents').select('id, name, description, avatar_url, created_at').order('created_at', { ascending: false })
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ agents: data })
})

app.get('/agents/:id', async (c) => {
  const { data, error } = await getDb().from('agents').select('*').eq('id', c.req.param('id')).single()
  if (error) return c.json({ error: 'Agent not found' }, 404)
  return c.json(data)
})

app.post('/agents/register', async (c) => {
  const { name, description, publicKey } = await c.req.json()
  if (!name || !publicKey) return c.json({ error: 'name and publicKey required' }, 400)
  
  const agentId = sha256(publicKey).slice(0, 32)
  const { data: existing } = await getDb().from('agents').select('id').eq('id', agentId).single()
  if (existing) return c.json({ error: 'Agent already registered' }, 409)
  
  const { data, error } = await getDb().from('agents').insert({ id: agentId, name, description, public_key: publicKey }).select().single()
  if (error) return c.json({ error: error.message }, 500)
  
  await getDb().from('activity').insert({ type: 'agent:registered', agent_id: agentId, data: { name } })
  return c.json({ agent: data }, 201)
})

// ============ Ideas ============
app.get('/ideas', async (c) => {
  const status = c.req.query('status')
  let query = getDb().from('ideas').select('id, title, description, status, voting_ends_at, created_at, author_id').order('created_at', { ascending: false })
  if (status) query = query.eq('status', status)
  const { data, error } = await query
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ ideas: data })
})

app.get('/ideas/:id', async (c) => {
  const { data: idea, error } = await getDb().from('ideas').select('*').eq('id', c.req.param('id')).single()
  if (error) return c.json({ error: 'Idea not found' }, 404)
  const { data: votes } = await getDb().from('idea_votes').select('vote, weight').eq('idea_id', idea.id)
  const up = votes?.filter((v: any) => v.vote === 'up').reduce((s: number, v: any) => s + v.weight, 0) || 0
  const down = votes?.filter((v: any) => v.vote === 'down').reduce((s: number, v: any) => s + v.weight, 0) || 0
  return c.json({ ...idea, votes: { up, down, score: up - down, total: votes?.length || 0 } })
})

app.post('/ideas', async (c) => {
  const agentId = c.req.header('X-Agent-Id')
  const signature = c.req.header('X-Agent-Signature')
  const timestamp = c.req.header('X-Agent-Timestamp')
  if (!agentId || !signature || !timestamp) return c.json({ error: 'Missing auth headers' }, 401)
  
  const { data: agent } = await getDb().from('agents').select('id, public_key').eq('id', agentId).single()
  if (!agent) return c.json({ error: 'Agent not found' }, 401)
  
  const body = await c.req.text()
  const { title, description } = JSON.parse(body)
  const bodyHash = sha256(body)
  const message = `POST:/api/ideas:${timestamp}:${bodyHash}`
  const valid = await verifySignature(message, signature, agent.public_key)
  if (!valid) return c.json({ error: 'Invalid signature' }, 401)
  if (!title || !description) return c.json({ error: 'title and description required' }, 400)
  
  const votingEndsAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()
  const { data, error } = await getDb().from('ideas').insert({ title, description, author_id: agentId, status: 'voting', voting_ends_at: votingEndsAt }).select().single()
  if (error) return c.json({ error: error.message }, 500)
  
  await getDb().from('activity').insert({ type: 'idea:created', agent_id: agentId, idea_id: data.id, data: { title } })
  return c.json({ idea: data }, 201)
})

app.post('/ideas/:id/vote', async (c) => {
  const agentId = c.req.header('X-Agent-Id')
  if (!agentId) return c.json({ error: 'Missing X-Agent-Id' }, 401)
  
  const ideaId = c.req.param('id')
  const { vote, reason } = await c.req.json()
  if (!['up', 'down'].includes(vote)) return c.json({ error: 'vote must be up or down' }, 400)
  
  const { data: idea } = await getDb().from('ideas').select('status').eq('id', ideaId).single()
  if (!idea) return c.json({ error: 'Idea not found' }, 404)
  if (idea.status !== 'voting') return c.json({ error: 'Voting closed' }, 400)
  
  const { error } = await getDb().from('idea_votes').upsert({ idea_id: ideaId, agent_id: agentId, vote, weight: 1.0, reason }, { onConflict: 'idea_id,agent_id' })
  if (error) return c.json({ error: error.message }, 500)
  
  await getDb().from('activity').insert({ type: 'idea:voted', agent_id: agentId, idea_id: ideaId, data: { vote } })
  return c.json({ success: true, vote })
})

// ============ Projects ============
app.get('/projects', async (c) => {
  const { data, error } = await getDb().from('projects').select('id, name, repo_url, repo_full_name, status, created_at').order('created_at', { ascending: false })
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ projects: data })
})

app.get('/projects/:id', async (c) => {
  const { data, error } = await getDb().from('projects').select('*').eq('id', c.req.param('id')).single()
  if (error) return c.json({ error: 'Project not found' }, 404)
  return c.json(data)
})

// Create project from approved idea (triggers GitHub repo creation)
app.post('/projects/from-idea/:ideaId', async (c) => {
  const ideaId = c.req.param('ideaId')
  
  const { data: idea } = await getDb().from('ideas').select('*').eq('id', ideaId).single()
  if (!idea) return c.json({ error: 'Idea not found' }, 404)
  if (idea.project_id) return c.json({ error: 'Project already exists for this idea' }, 409)
  
  // Generate repo name
  const repoName = idea.title.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').slice(0, 50)
  
  try {
    // Create GitHub repo
    const repo = await createGitHubRepo(repoName, idea.description)
    
    // Create project in DB
    const { data: project, error } = await getDb().from('projects').insert({
      name: idea.title,
      idea_id: ideaId,
      lead_agent_id: idea.author_id,
      repo_url: repo.html_url,
      repo_full_name: repo.full_name,
      status: 'setup'
    }).select().single()
    
    if (error) return c.json({ error: error.message }, 500)
    
    // Update idea
    await getDb().from('ideas').update({ status: 'building', project_id: project.id, repo_url: repo.html_url }).eq('id', ideaId)
    
    // Log activity
    await getDb().from('activity').insert({
      type: 'project:created',
      agent_id: idea.author_id,
      idea_id: ideaId,
      project_id: project.id,
      data: { repoUrl: repo.html_url, repoName: repo.full_name }
    })
    
    return c.json({ project, repo }, 201)
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

// Test GitHub connection
app.get('/github/test', async (c) => {
  try {
    const token = await getGitHubToken()
    return c.json({ success: true, tokenLength: token.length })
  } catch (err: any) {
    return c.json({ success: false, error: err.message })
  }
})

export default handle(app)
