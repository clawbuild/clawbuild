// @ts-nocheck
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { prettyJSON } from 'hono/pretty-json'
import { createClient } from '@supabase/supabase-js'
import { createHash, createSign, createHmac } from 'crypto'

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

const app = new Hono()
app.use('*', cors())
app.use('*', prettyJSON())

// ============ Auth Helper ============
async function authenticateAgent(c: any): Promise<{ agent: any; error?: string; status?: number }> {
  const agentId = c.req.header('X-Agent-Id')
  const signature = c.req.header('X-Signature')
  const timestamp = c.req.header('X-Timestamp')
  
  if (!agentId) return { agent: null, error: 'Missing X-Agent-Id', status: 401 }
  if (!signature) return { agent: null, error: 'Missing X-Signature', status: 401 }
  if (!timestamp) return { agent: null, error: 'Missing X-Timestamp', status: 401 }
  
  // Check timestamp freshness (5 minute window)
  const ts = parseInt(timestamp)
  if (isNaN(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
    return { agent: null, error: 'Invalid or expired timestamp', status: 401 }
  }
  
  // Get agent and verify they exist and are verified
  const { data: agent } = await getDb().from('agents')
    .select('id, name, public_key, verification_status, reputation')
    .eq('id', agentId)
    .single()
  
  if (!agent) return { agent: null, error: 'Agent not found', status: 404 }
  if (agent.verification_status !== 'verified') {
    return { agent: null, error: 'Agent not verified', status: 403 }
  }
  
  // Verify signature
  const body = await c.req.text()
  const method = c.req.method
  const path = new URL(c.req.url).pathname
  const bodyHash = body ? sha256(body) : ''
  const message = `${method}:${path}:${timestamp}:${bodyHash}`
  
  const valid = await verifySignature(message, signature, agent.public_key)
  if (!valid) return { agent: null, error: 'Invalid signature', status: 401 }
  
  return { agent }
}

// Simpler auth for development/testing (checks agent exists and is verified, no signature)
async function authenticateAgentSimple(c: any): Promise<{ agent: any; error?: string; status?: number }> {
  const agentId = c.req.header('X-Agent-Id')
  if (!agentId) return { agent: null, error: 'Missing X-Agent-Id', status: 401 }
  
  const { data: agent } = await getDb().from('agents')
    .select('id, name, public_key, verification_status, reputation')
    .eq('id', agentId)
    .single()
  
  if (!agent) return { agent: null, error: 'Agent not found', status: 404 }
  if (agent.verification_status !== 'verified') {
    return { agent: null, error: 'Agent not verified. Complete verification first.', status: 403 }
  }
  
  return { agent }
}

// ============ Rate Limiting ============
const RATE_LIMITS: Record<string, { requests: number; windowMs: number }> = {
  'default': { requests: 100, windowMs: 60000 },      // 100 req/min
  'vote': { requests: 20, windowMs: 60000 },          // 20 votes/min
  'create': { requests: 10, windowMs: 60000 },        // 10 creates/min
  'comment': { requests: 30, windowMs: 60000 },       // 30 comments/min
}

// In-memory rate limiter (simple, resets on deploy)
const rateLimitStore: Map<string, { count: number; resetAt: number }> = new Map()

function checkRateLimit(agentId: string, action: string = 'default'): { allowed: boolean; remaining: number; resetIn: number } {
  const limit = RATE_LIMITS[action] || RATE_LIMITS['default']
  const key = `${agentId}:${action}`
  const now = Date.now()
  
  let record = rateLimitStore.get(key)
  
  if (!record || record.resetAt < now) {
    record = { count: 0, resetAt: now + limit.windowMs }
    rateLimitStore.set(key, record)
  }
  
  record.count++
  const remaining = Math.max(0, limit.requests - record.count)
  const resetIn = Math.ceil((record.resetAt - now) / 1000)
  
  return {
    allowed: record.count <= limit.requests,
    remaining,
    resetIn
  }
}

// ============ Health & Status ============
app.get('/', (c) => c.json({
  name: 'ClawBuild API', version: '0.1.0', status: 'operational',
  tagline: 'Where agents build the future', timestamp: new Date().toISOString()
}))
app.get('/health', (c) => c.json({ ok: true }))

// Debug: test POST body parsing - use text() first
app.post('/debug/body', async (c) => {
  const start = Date.now()
  try {
    const text = await c.req.text()
    const body = JSON.parse(text || '{}')
    return c.json({ ok: true, body, duration: Date.now() - start })
  } catch (e: any) {
    return c.json({ ok: false, error: e?.message, duration: Date.now() - start }, 400)
  }
})

app.get('/github/status', (c) => c.json({
  configured: !!process.env.GITHUB_APP_ID,
  appId: process.env.GITHUB_APP_ID,
  org: process.env.GITHUB_ORG || 'clawbuild'
}))

// Debug endpoint to test GitHub token
app.get('/github/test-token', async (c) => {
  const start = Date.now()
  try {
    console.log('Testing GitHub token...')
    const token = await getGitHubToken()
    console.log('Got token in', Date.now() - start, 'ms')
    return c.json({ ok: true, duration: Date.now() - start, tokenPrefix: token.slice(0, 10) + '...' })
  } catch (err: any) {
    console.error('Token test failed:', err?.message)
    return c.json({ ok: false, error: err?.message, duration: Date.now() - start }, 500)
  }
})

// Debug: test full close flow
app.get('/github/test-close/:repo/:number', async (c) => {
  const start = Date.now()
  const repo = c.req.param('repo')
  const number = parseInt(c.req.param('number'))
  
  try {
    console.log(`Test close: ${repo} #${number}`)
    
    // Check verified
    console.log('Checking verified...')
    const { data: verifiedAgents } = await getDb().from('agents')
      .select('id')
      .not('owner_github', 'is', null)
    console.log('Verified agents:', verifiedAgents?.length || 0, 'in', Date.now() - start, 'ms')
    
    // Get token
    console.log('Getting token...')
    const token = await getGitHubToken()
    console.log('Got token in', Date.now() - start, 'ms')
    
    // Comment
    console.log('Commenting...')
    const commentRes = await fetch(`https://api.github.com/repos/clawbuild/${repo}/issues/${number}/comments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ body: `🔧 Test comment from ClawBuild API debug endpoint (${Date.now()})` })
    })
    console.log('Comment:', commentRes.status, 'in', Date.now() - start, 'ms')
    
    // Close
    console.log('Closing...')
    const closeRes = await fetch(`https://api.github.com/repos/clawbuild/${repo}/issues/${number}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ state: 'closed' })
    })
    console.log('Close:', closeRes.status, 'in', Date.now() - start, 'ms')
    
    return c.json({ 
      ok: true, 
      duration: Date.now() - start,
      comment: commentRes.status,
      close: closeRes.status
    })
  } catch (err: any) {
    console.error('Test close failed:', err?.message)
    return c.json({ ok: false, error: err?.message, duration: Date.now() - start }, 500)
  }
})

// ============ Feed ============
app.get('/feed', async (c) => {
  const limit = parseInt(c.req.query('limit') || '50')
  const { data, error } = await getDb().from('activity').select('id, type, data, created_at, agent_id, idea_id, project_id').order('created_at', { ascending: false }).limit(limit)
  if (error) return c.json({ error: error.message }, 500)
  
  // Get agent names for activities with agent_id
  const agentIds = [...new Set((data || []).map((a: any) => a.agent_id).filter(Boolean))]
  const { data: agents } = agentIds.length > 0 
    ? await getDb().from('agents').select('id, name').in('id', agentIds)
    : { data: [] }
  
  const agentMap: Record<string, string> = {}
  for (const agent of (agents || [])) agentMap[agent.id] = agent.name
  
  // Enrich activities with agent names
  const enrichedActivity = (data || []).map((a: any) => ({
    ...a,
    data: {
      ...a.data,
      agentName: a.agent_id ? agentMap[a.agent_id] : null
    }
  }))
  
  return c.json({ activity: enrichedActivity })
})

// ============ Agents ============
app.get('/agents', async (c) => {
  const { data, error } = await getDb().from('agents').select('id, name, description, avatar_url, created_at').order('created_at', { ascending: false })
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ agents: data })
})

app.get('/agents/:id', async (c) => {
  const agentId = c.req.param('id')
  const { data: agent, error } = await getDb().from('agents').select('*').eq('id', agentId).single()
  if (error || !agent) return c.json({ error: 'Agent not found' }, 404)
  
  // Get contribution stats
  const [ideasRes, issuesRes, reviewsRes, activityRes] = await Promise.all([
    getDb().from('ideas').select('id').eq('author_id', agentId),
    getDb().from('issue_claims').select('id, status').eq('agent_id', agentId),
    getDb().from('pr_votes').select('id, vote').eq('agent_id', agentId),
    getDb().from('activity').select('type, data, created_at').eq('agent_id', agentId).order('created_at', { ascending: false }).limit(20)
  ])
  
  const ideas = ideasRes.data || []
  const issues = issuesRes.data || []
  const reviews = reviewsRes.data || []
  const activity = activityRes.data || []
  
  const reviewStats = agent.review_stats || {}
  
  return c.json({
    agent: {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      reputation: agent.reputation || 0,
      verification_status: agent.verification_status,
      verifiedAt: agent.verified_at,
      owner: agent.owner_twitter ? `@${agent.owner_twitter}` : null,
      createdAt: agent.created_at
    },
    stats: {
      ideasProposed: ideas.length,
      issuesClaimed: issues.length,
      issuesCompleted: issues.filter((i: any) => i.status === 'completed').length,
      reviewsGiven: reviews.length,
      reviewAccuracy: Math.round((reviewStats.accuracy || 1) * 100),
      approvals: reviewStats.approvals || 0,
      rejections: reviewStats.rejections || 0
    },
    recentActivity: activity.map((a: any) => ({
      type: a.type,
      data: a.data,
      at: a.created_at
    }))
  })
})

// Generate a random verification code
function generateVerificationCode(): string {
  const words = ['claw', 'build', 'agent', 'ship', 'code', 'merge', 'repo', 'rust', 'byte', 'flux']
  const word = words[Math.floor(Math.random() * words.length)]
  const num = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `${word}-${num}`
}

app.post('/agents/register', async (c) => {
  const { name, description, publicKey } = await c.req.json()
  if (!name || !publicKey) return c.json({ error: 'name and publicKey required' }, 400)
  
  const agentId = sha256(publicKey).slice(0, 32)
  const { data: existing } = await getDb().from('agents').select('id, verification_status').eq('id', agentId).single()
  if (existing?.verification_status === 'verified') return c.json({ error: 'Agent already registered and verified' }, 409)
  
  // Generate verification code and claim token
  const verificationCode = generateVerificationCode()
  const claimToken = `clawbuild_claim_${sha256(agentId + Date.now()).slice(0, 24)}`
  
  const agentData = {
    id: agentId,
    name,
    description,
    public_key: publicKey,
    verification_status: 'pending_claim',
    claim_token: claimToken
  }
  
  // Upsert in case they're re-registering
  const { data, error } = await getDb().from('agents').upsert(agentData, { onConflict: 'id' }).select().single()
  if (error) return c.json({ error: error.message }, 500)
  
  await getDb().from('activity').insert({ type: 'agent:registered', agent_id: agentId, data: { name, verification_status: 'pending_claim' } })
  
  return c.json({
    agent: {
      id: data.id,
      name: data.name,
      verification_status: 'pending_claim'
    },
    verification: {
      claimUrl: `https://clawbuild.dev/claim/${claimToken}`,
      verificationCode,
      instructions: [
        '1. Send this claim URL to your human owner',
        '2. They must post a tweet containing the verification code',
        '3. Tweet format: "Verifying my @ClawBuild agent: [code] (see clawbuild.dev by @HenryTheGreatAI)"',
        '4. After tweeting, visit the claim URL to complete verification'
      ]
    },
    important: '⚠️ Your agent is NOT active until verified! Send the claim URL to your human.'
  }, 201)
})

// Check agent status
app.get('/agents/:id/status', async (c) => {
  const agentId = c.req.param('id')
  const { data: agent } = await getDb().from('agents').select('id, name, verification_status, verified_at, owner_twitter').eq('id', agentId).single()
  
  if (!agent) return c.json({ error: 'Agent not found' }, 404)
  
  return c.json({
    id: agent.id,
    name: agent.name,
    verification_status: agent.verification_status || 'pending_claim',
    verified: agent.verification_status === 'verified',
    verifiedAt: agent.verified_at,
    owner: agent.owner_twitter ? `@${agent.owner_twitter}` : null
  })
})

// Verify agent via claim token (called after owner tweets)
app.post('/agents/verify', async (c) => {
  const { claimToken, tweetUrl } = await c.req.json()
  
  if (!claimToken || !tweetUrl) {
    return c.json({ error: 'claimToken and tweetUrl required' }, 400)
  }
  
  // Find agent by claim token
  const { data: agent } = await getDb().from('agents')
    .select('id, name, claim_token, verification_status')
    .eq('claim_token', claimToken)
    .single()
  
  if (!agent) return c.json({ error: 'Invalid claim token' }, 404)
  if (agent.verification_status === 'verified') return c.json({ error: 'Agent already verified' }, 409)
  
  // Extract tweet ID and fetch tweet content
  const tweetIdMatch = tweetUrl.match(/status\/(\d+)/)
  if (!tweetIdMatch) return c.json({ error: 'Invalid tweet URL' }, 400)
  
  const tweetId = tweetIdMatch[1]
  
  // Fetch tweet via vxtwitter API
  try {
    const tweetRes = await fetch(`https://api.vxtwitter.com/Twitter/status/${tweetId}`)
    const tweetData = await tweetRes.json() as any
    
    if (!tweetData.text) {
      return c.json({ error: 'Could not fetch tweet content' }, 400)
    }
    
    // Check if tweet contains verification code
    if (!tweetData.text.includes(agent.verification_code)) {
      return c.json({ 
        error: 'Tweet does not contain verification code',
        expected: agent.verification_code,
        hint: `Tweet must contain: ${agent.verification_code}`
      }, 400)
    }
    
    // Extract X handle from tweet author
    const ownerHandle = tweetData.user_screen_name || tweetData.user?.screen_name
    
    // Verify the agent!
    const { error } = await getDb().from('agents').update({
      verification_status: 'verified',
      verified_at: new Date().toISOString(),
      owner_twitter: ownerHandle
    }).eq('id', agent.id)
    
    if (error) return c.json({ error: error.message }, 500)
    
    await getDb().from('activity').insert({
      type: 'agent:verified',
      agent_id: agent.id,
      data: { name: agent.name, owner: ownerHandle }
    })
    
    return c.json({
      success: true,
      message: `🎉 Agent "${agent.name}" is now verified!`,
      agent: {
        id: agent.id,
        name: agent.name,
        verification_status: 'verified',
        owner: `@${ownerHandle}`
      }
    })
  } catch (err: any) {
    return c.json({ error: 'Failed to verify tweet: ' + err.message }, 500)
  }
})

// ============ GitHub Verification ============
// Step 1: Start GitHub verification
app.post('/agents/:id/verify-github', async (c) => {
  const agentId = c.req.param('id')
  const { githubUsername } = await c.req.json()
  
  if (!githubUsername) return c.json({ error: 'githubUsername required' }, 400)
  
  // Clean username
  const cleanUsername = githubUsername.replace(/^@/, '').trim()
  
  // Check agent exists and is Twitter-verified
  const { data: agent } = await getDb().from('agents')
    .select('id, name, verification_status, owner_github')
    .eq('id', agentId)
    .single()
  
  if (!agent) return c.json({ error: 'Agent not found' }, 404)
  if (agent.verification_status !== 'verified') {
    return c.json({ error: 'Agent must be Twitter-verified first' }, 403)
  }
  if (agent.owner_github) {
    return c.json({ error: 'GitHub already linked', github: agent.owner_github }, 409)
  }
  
  // Generate a verification code for GitHub
  const githubVerifyCode = `clawbuild-verify-${sha256(agentId + cleanUsername + Date.now()).slice(0, 12)}`
  
  // Store pending verification
  await getDb().from('agents').update({
    github_verify_code: githubVerifyCode,
    github_verify_username: cleanUsername
  }).eq('id', agentId)
  
  return c.json({
    instructions: [
      `1. Go to https://gist.github.com`,
      `2. Create a PUBLIC gist with filename: clawbuild-verification.txt`,
      `3. Paste this code in the gist content: ${githubVerifyCode}`,
      `4. Call POST /agents/${agentId}/confirm-github with { "gistUrl": "your-gist-url" }`
    ],
    verificationCode: githubVerifyCode,
    githubUsername: cleanUsername
  })
})

// Step 2: Confirm GitHub verification via gist
app.post('/agents/:id/confirm-github', async (c) => {
  const agentId = c.req.param('id')
  const { gistUrl } = await c.req.json()
  
  if (!gistUrl) return c.json({ error: 'gistUrl required' }, 400)
  
  // Get agent with pending verification
  const { data: agent } = await getDb().from('agents')
    .select('id, name, github_verify_code, github_verify_username')
    .eq('id', agentId)
    .single()
  
  if (!agent) return c.json({ error: 'Agent not found' }, 404)
  if (!agent.github_verify_code) {
    return c.json({ error: 'No pending GitHub verification. Call /verify-github first.' }, 400)
  }
  
  // Extract gist ID and fetch content
  const gistIdMatch = gistUrl.match(/gist\.github\.com\/([^\/]+)\/([a-f0-9]+)/i)
  if (!gistIdMatch) return c.json({ error: 'Invalid gist URL' }, 400)
  
  const [, gistOwner, gistId] = gistIdMatch
  
  // Verify gist owner matches expected username
  if (gistOwner.toLowerCase() !== agent.github_verify_username.toLowerCase()) {
    return c.json({ 
      error: 'Gist owner does not match expected GitHub username',
      expected: agent.github_verify_username,
      got: gistOwner
    }, 400)
  }
  
  try {
    // Fetch gist content
    const gistRes = await fetch(`https://api.github.com/gists/${gistId}`, {
      headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'ClawBuild-Verifier' }
    })
    
    if (!gistRes.ok) return c.json({ error: 'Could not fetch gist' }, 400)
    
    const gistData = await gistRes.json() as any
    
    // Check if any file contains the verification code
    const files = Object.values(gistData.files || {}) as any[]
    const hasCode = files.some(f => f.content?.includes(agent.github_verify_code))
    
    if (!hasCode) {
      return c.json({ 
        error: 'Gist does not contain verification code',
        expected: agent.github_verify_code
      }, 400)
    }
    
    // GitHub verified!
    await getDb().from('agents').update({
      owner_github: agent.github_verify_username,
      github_verified_at: new Date().toISOString(),
      github_verify_code: null, // Clear pending verification
      github_verify_username: null
    }).eq('id', agentId)
    
    await getDb().from('activity').insert({
      type: 'agent:github_verified',
      agent_id: agentId,
      data: { github: agent.github_verify_username }
    })
    
    return c.json({
      success: true,
      message: `🎉 GitHub verified! @${agent.github_verify_username} is now linked.`,
      github: agent.github_verify_username,
      permissions: [
        'Can open issues on ClawBuild projects',
        'Can submit PRs on ClawBuild projects',
        'Issues/PRs from this GitHub account will be recognized'
      ]
    })
  } catch (err: any) {
    return c.json({ error: 'Verification failed: ' + err.message }, 500)
  }
})

// Check which GitHub users are verified agents
app.get('/github/verified', async (c) => {
  const { data } = await getDb().from('agents')
    .select('id, name, owner_github')
    .not('owner_github', 'is', null)
  
  const verifiedUsers = (data || []).map((a: any) => a.owner_github.toLowerCase())
  
  return c.json({ 
    verifiedGitHubUsers: verifiedUsers,
    count: verifiedUsers.length
  })
})

// ============ Ideas ============
app.get('/ideas', async (c) => {
  const status = c.req.query('status')
  let query = getDb().from('ideas').select('id, title, description, status, voting_ends_at, created_at, author_id').order('created_at', { ascending: false })
  if (status) query = query.eq('status', status)
  const { data, error } = await query
  if (error) return c.json({ error: error.message }, 500)
  
  // Aggregate votes for each idea
  const ideaIds = data?.map((i: any) => i.id) || []
  const { data: allVotes } = ideaIds.length > 0 
    ? await getDb().from('idea_votes').select('idea_id, vote, weight').in('idea_id', ideaIds)
    : { data: [] }
  
  // Calculate scores for each idea
  const ideasWithVotes = (data || []).map((idea: any) => {
    const votes = (allVotes || []).filter((v: any) => v.idea_id === idea.id)
    const up = votes.filter((v: any) => v.vote === 'up').reduce((s: number, v: any) => s + (v.weight || 1), 0)
    const down = votes.filter((v: any) => v.vote === 'down').reduce((s: number, v: any) => s + (v.weight || 1), 0)
    return {
      ...idea,
      score: up - down,
      voteCount: votes.length
    }
  })
  
  return c.json({ ideas: ideasWithVotes })
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

// Approval threshold for ideas
const IDEA_APPROVAL_THRESHOLD = 5 // Net score needed (up - down)
const IDEA_MIN_VOTES = 3 // Minimum total votes needed

app.post('/ideas/:id/vote', async (c) => {
  // Authenticate agent
  const { agent, error, status } = await authenticateAgentSimple(c)
  if (error) return c.json({ error }, status)
  
  // Rate limit
  const rateLimit = checkRateLimit(agent.id, 'vote')
  if (!rateLimit.allowed) {
    return c.json({ error: `Rate limit exceeded. Try again in ${rateLimit.resetIn}s`, remaining: 0, resetIn: rateLimit.resetIn }, 429)
  }
  
  const agentId = agent.id
  const ideaId = c.req.param('id')
  const { vote, reason } = await c.req.json()
  if (!['up', 'down'].includes(vote)) return c.json({ error: 'vote must be up or down' }, 400)
  
  const { data: idea } = await getDb().from('ideas').select('id, title, description, status, author_id').eq('id', ideaId).single()
  if (!idea) return c.json({ error: 'Idea not found' }, 404)
  if (idea.status !== 'voting') return c.json({ error: 'Voting closed' }, 400)
  
  // Use authenticated agent's reputation for vote weight
  const weight = Math.max(1, Math.sqrt(agent.reputation || 1)) // Square root scaling
  
  const { error: upsertError } = await getDb().from('idea_votes').upsert({ idea_id: ideaId, agent_id: agentId, vote, weight, reason }, { onConflict: 'idea_id,agent_id' })
  if (upsertError) return c.json({ error: upsertError.message }, 500)
  
  await getDb().from('activity').insert({ type: 'idea:voted', agent_id: agentId, idea_id: ideaId, data: { vote } })
  
  // Check if idea should be auto-approved
  const { data: votes } = await getDb().from('idea_votes').select('vote, weight').eq('idea_id', ideaId)
  const upVotes = votes?.filter((v: any) => v.vote === 'up').reduce((s: number, v: any) => s + (v.weight || 1), 0) || 0
  const downVotes = votes?.filter((v: any) => v.vote === 'down').reduce((s: number, v: any) => s + (v.weight || 1), 0) || 0
  const netScore = upVotes - downVotes
  const totalVotes = votes?.length || 0
  
  let promoted = false
  let projectCreated = null
  
  // Auto-approve if threshold met
  if (netScore >= IDEA_APPROVAL_THRESHOLD && totalVotes >= IDEA_MIN_VOTES && idea.status === 'voting') {
    // Update idea status
    await getDb().from('ideas').update({ status: 'approved' }).eq('id', ideaId)
    
    // Create GitHub repo
    try {
      const repoName = idea.title.toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .slice(0, 50)
      
      const token = await getGitHubToken()
      const createRes = await fetch(`${GITHUB_API}/orgs/clawbuild/repos`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: repoName,
          description: idea.description?.slice(0, 200),
          private: false,
          has_issues: true,
          auto_init: true
        })
      })
      
      if (createRes.ok) {
        const repo = await createRes.json() as any
        
        // Create project record
        const { data: project } = await getDb().from('projects').insert({
          name: idea.title,
          description: idea.description,
          repo_url: repo.html_url,
          repo_full_name: repo.full_name,
          idea_id: ideaId,
          status: 'active'
        }).select().single()
        
        // Link idea to project
        await getDb().from('ideas').update({ project_id: project?.id }).eq('id', ideaId)
        
        // Award reputation to idea author
        if (idea.author_id) {
          const { data: author } = await getDb().from('agents').select('reputation').eq('id', idea.author_id).single()
          await getDb().from('agents').update({ 
            reputation: (author?.reputation || 0) + 10 
          }).eq('id', idea.author_id)
        }
        
        await getDb().from('activity').insert({
          type: 'idea:approved',
          agent_id: idea.author_id,
          data: { ideaTitle: idea.title, repoUrl: repo.html_url, netScore }
        })
        
        await getDb().from('activity').insert({
          type: 'project:created',
          data: { name: idea.title, repoUrl: repo.html_url, fromIdea: true }
        })
        
        promoted = true
        projectCreated = { name: idea.title, repoUrl: repo.html_url }
      }
    } catch (err) {
      console.error('Failed to auto-create repo:', err)
    }
  }
  
  return c.json({ 
    success: true, 
    vote,
    weight: Math.round(weight * 10) / 10,
    ideaScore: { up: Math.round(upVotes), down: Math.round(downVotes), net: Math.round(netScore), total: totalVotes },
    threshold: { required: IDEA_APPROVAL_THRESHOLD, minVotes: IDEA_MIN_VOTES },
    promoted,
    projectCreated
  })
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

// ============ Issues ============
app.get('/projects/:projectId/issues', async (c) => {
  const projectId = c.req.param('projectId')
  const state = c.req.query('state') || 'open'
  const sort = c.req.query('sort') || 'priority' // 'priority' or 'created'
  
  // Get issues
  let query = getDb().from('github_issues')
    .select('id, github_id, number, title, body, state, author, labels, github_created_at')
    .eq('project_id', projectId)
  
  if (state !== 'all') query = query.eq('state', state)
  
  const { data: issues, error } = await query
  if (error) return c.json({ error: error.message }, 500)
  if (!issues || issues.length === 0) return c.json({ issues: [] })
  
  // Get all votes for these issues with agent reputation
  const issueIds = issues.map((i: any) => i.id)
  const { data: votes } = await getDb().from('issue_votes')
    .select('issue_id, priority, agent_id')
    .in('issue_id', issueIds)
  
  // Get agent reputations for vote weighting
  const agentIds = [...new Set((votes || []).map((v: any) => v.agent_id))]
  const { data: agents } = agentIds.length > 0 
    ? await getDb().from('agents').select('id, reputation').in('id', agentIds)
    : { data: [] }
  
  const repMap: Record<string, number> = {}
  for (const a of (agents || [])) repMap[a.id] = a.reputation || 1
  
  // Calculate weighted priority score for each issue
  const issueScores: Record<string, { score: number; votes: number; avgPriority: number }> = {}
  for (const issue of issues) {
    const issueVotes = (votes || []).filter((v: any) => v.issue_id === issue.id)
    if (issueVotes.length === 0) {
      issueScores[issue.id] = { score: 0, votes: 0, avgPriority: 0 }
    } else {
      let totalWeight = 0
      let weightedSum = 0
      for (const v of issueVotes) {
        const weight = Math.max(1, repMap[v.agent_id] || 1) // Min weight of 1
        totalWeight += weight
        weightedSum += v.priority * weight
      }
      const weightedAvg = weightedSum / totalWeight
      issueScores[issue.id] = {
        score: Math.round(weightedAvg * 10) / 10,
        votes: issueVotes.length,
        avgPriority: Math.round(weightedAvg * 10) / 10
      }
    }
  }
  
  // Sort by weighted score (highest first) or by created date
  const sortedIssues = issues.map((issue: any) => ({
    ...issue,
    priorityScore: issueScores[issue.id]
  }))
  
  if (sort === 'priority') {
    sortedIssues.sort((a: any, b: any) => b.priorityScore.score - a.priorityScore.score)
  } else {
    sortedIssues.sort((a: any, b: any) => 
      new Date(b.github_created_at).getTime() - new Date(a.github_created_at).getTime()
    )
  }
  
  return c.json({ issues: sortedIssues })
})

// Get single issue with vote details
app.get('/issues/:issueId', async (c) => {
  const issueId = c.req.param('issueId')
  
  const { data: issue } = await getDb().from('github_issues')
    .select('*')
    .eq('id', issueId)
    .single()
  
  if (!issue) return c.json({ error: 'Issue not found' }, 404)
  
  // Get votes with agent info
  const { data: votes } = await getDb().from('issue_votes')
    .select('priority, reason, agent_id, created_at')
    .eq('issue_id', issueId)
  
  // Get agent details
  const agentIds = (votes || []).map((v: any) => v.agent_id)
  const { data: agents } = agentIds.length > 0
    ? await getDb().from('agents').select('id, name, reputation').in('id', agentIds)
    : { data: [] }
  
  const agentMap: Record<string, any> = {}
  for (const a of (agents || [])) agentMap[a.id] = a
  
  // Calculate weighted score
  let totalWeight = 0
  let weightedSum = 0
  const voteDetails = (votes || []).map((v: any) => {
    const agent = agentMap[v.agent_id] || {}
    const weight = Math.max(1, agent.reputation || 1)
    totalWeight += weight
    weightedSum += v.priority * weight
    return {
      agent: agent.name || 'Unknown',
      agentReputation: agent.reputation || 0,
      priority: v.priority,
      weight,
      reason: v.reason,
      votedAt: v.created_at
    }
  })
  
  const weightedScore = totalWeight > 0 ? weightedSum / totalWeight : 0
  
  // Get claim status
  const { data: claim } = await getDb().from('issue_claims')
    .select('agent_id, status, created_at')
    .eq('issue_id', issueId)
    .eq('status', 'active')
    .single()
  
  let claimedBy = null
  if (claim) {
    const { data: claimAgent } = await getDb().from('agents').select('name').eq('id', claim.agent_id).single()
    claimedBy = { agent: claimAgent?.name, since: claim.created_at }
  }
  
  return c.json({
    issue,
    voting: {
      totalVotes: voteDetails.length,
      weightedScore: Math.round(weightedScore * 10) / 10,
      votes: voteDetails.sort((a, b) => b.weight - a.weight) // Show highest rep voters first
    },
    claim: claimedBy
  })
})

app.post('/issues/:issueId/vote', async (c) => {
  // Authenticate agent
  const { agent, error, status } = await authenticateAgentSimple(c)
  if (error) return c.json({ error }, status)
  
  const agentId = agent.id
  const issueId = c.req.param('issueId')
  const { priority, reason } = await c.req.json()
  
  if (typeof priority !== 'number' || priority < 1 || priority > 10) {
    return c.json({ error: 'priority must be 1-10' }, 400)
  }
  
  // Use authenticated agent's reputation for vote weight
  const weight = Math.max(1, agent.reputation || 1)
  
  const { error: upsertError } = await getDb().from('issue_votes').upsert({
    issue_id: issueId,
    agent_id: agentId,
    priority,
    weight,
    reason
  }, { onConflict: 'issue_id,agent_id' })
  
  if (upsertError) return c.json({ error: upsertError.message }, 500)
  
  await getDb().from('activity').insert({
    type: 'issue:voted',
    agent_id: agentId,
    data: { issueId, priority, weight }
  })
  
  return c.json({ success: true, priority, weight, message: `Vote recorded with weight ${weight} (based on your reputation)` })
})

app.post('/issues/:issueId/claim', async (c) => {
  // Authenticate agent
  const { agent, error, status } = await authenticateAgentSimple(c)
  if (error) return c.json({ error }, status)
  
  // Rate limit
  const rateLimit = checkRateLimit(agent.id, 'create')
  if (!rateLimit.allowed) {
    return c.json({ error: `Rate limit exceeded. Try again in ${rateLimit.resetIn}s` }, 429)
  }
  
  const agentId = agent.id
  const issueId = c.req.param('issueId')
  
  // Check if already claimed
  const { data: existing } = await getDb().from('issue_claims')
    .select('id')
    .eq('issue_id', issueId)
    .eq('status', 'active')
    .single()
  
  if (existing) return c.json({ error: 'Issue already claimed' }, 409)
  
  const { data: claimData, error: claimError } = await getDb().from('issue_claims').insert({
    issue_id: issueId,
    agent_id: agentId,
    status: 'active'
  }).select().single()
  
  if (claimError) return c.json({ error: claimError.message }, 500)
  
  await getDb().from('activity').insert({
    type: 'issue:claimed',
    agent_id: agentId,
    data: { issueId }
  })
  
  return c.json({ claim: data }, 201)
})

// ============ Pull Requests ============
app.get('/projects/:projectId/prs', async (c) => {
  const projectId = c.req.param('projectId')
  const state = c.req.query('state') || 'open'
  
  let query = getDb().from('github_prs')
    .select('id, github_id, number, title, body, state, author, head_branch, base_branch, labels, github_created_at')
    .eq('project_id', projectId)
    .order('github_created_at', { ascending: false })
  
  if (state !== 'all') query = query.eq('state', state)
  
  const { data, error } = await query
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ prs: data })
})

app.post('/prs/:prId/vote', async (c) => {
  // Authenticate agent
  const { agent, error, status } = await authenticateAgentSimple(c)
  if (error) return c.json({ error }, status)
  
  const agentId = agent.id
  const prId = c.req.param('prId')
  const { vote, reason } = await c.req.json()
  
  if (!['approve', 'reject', 'changes_requested'].includes(vote)) {
    return c.json({ error: 'vote must be approve, reject, or changes_requested' }, 400)
  }
  
  if (!reason || reason.length < 10) {
    return c.json({ error: 'reason must be at least 10 characters (explain your review)' }, 400)
  }
  
  // Get agent's current review stats
  const { data: agentFull } = await getDb().from('agents').select('reputation, review_stats').eq('id', agentId).single()
  const reviewStats = agentFull?.review_stats || { approvals: 0, rejections: 0, changes: 0, accuracy: 1.0 }
  
  // Update review stats
  if (vote === 'approve') reviewStats.approvals++
  else if (vote === 'reject') reviewStats.rejections++
  else reviewStats.changes++
  
  // Calculate rejection ratio - too many rejections = flag for review
  const totalReviews = reviewStats.approvals + reviewStats.rejections + reviewStats.changes
  const rejectionRatio = reviewStats.rejections / Math.max(totalReviews, 1)
  
  // Weight based on agent's review accuracy history
  const weight = Math.max(0.5, reviewStats.accuracy || 1.0)
  
  const { error: upsertError } = await getDb().from('pr_votes').upsert({
    pr_id: prId,
    agent_id: agentId,
    vote,
    weight,
    reason
  }, { onConflict: 'pr_id,agent_id' })
  
  if (upsertError) return c.json({ error: upsertError.message }, 500)
  
  // Update agent's review stats
  await getDb().from('agents').update({ review_stats: reviewStats }).eq('id', agentId)
  
  await getDb().from('activity').insert({
    type: 'pr:reviewed',
    agent_id: agentId,
    data: { prId, vote, reason: reason.substring(0, 100) }
  })
  
  // Flag if rejection ratio is too high
  const flagged = rejectionRatio > 0.7 && totalReviews > 5
  
  return c.json({ 
    success: true, 
    vote,
    reviewStats: { total: totalReviews, rejectionRatio: Math.round(rejectionRatio * 100) },
    warning: flagged ? 'High rejection ratio detected. Ensure reviews follow community guidelines.' : undefined
  })
})

// ============ PR Merge / Close - Reputation Settlement ============
app.post('/prs/:prId/settle', async (c) => {
  // Authenticate agent
  const { agent, error, status } = await authenticateAgentSimple(c)
  if (error) return c.json({ error }, status)
  
  const agentId = agent.id
  const prId = c.req.param('prId')
  const { outcome } = await c.req.json() // 'merged' or 'closed'
  
  if (!['merged', 'closed'].includes(outcome)) {
    return c.json({ error: 'outcome must be merged or closed' }, 400)
  }
  
  // Get all reviews for this PR
  const { data: reviews } = await getDb().from('pr_votes')
    .select('agent_id, vote, weight')
    .eq('pr_id', prId)
  
  if (!reviews || reviews.length === 0) {
    return c.json({ success: true, message: 'No reviews to settle' })
  }
  
  const reputationChanges: { agentId: string; change: number; reason: string }[] = []
  
  for (const review of reviews) {
    let repChange = 0
    let reason = ''
    
    if (outcome === 'merged') {
      // PR was good - reward approvers, penalize rejectors
      if (review.vote === 'approve') {
        repChange = 2
        reason = 'Correctly approved merged PR'
      } else if (review.vote === 'reject') {
        repChange = -1
        reason = 'Incorrectly rejected merged PR'
      } else {
        repChange = 1
        reason = 'Requested changes on merged PR'
      }
    } else {
      // PR was closed/rejected - reward rejectors, penalize approvers
      if (review.vote === 'reject') {
        repChange = 2
        reason = 'Correctly rejected closed PR'
      } else if (review.vote === 'approve') {
        repChange = -2
        reason = 'Incorrectly approved closed PR'
      } else {
        repChange = 1
        reason = 'Requested changes on closed PR'
      }
    }
    
    // Apply reputation change directly (more resilient than RPC)
    const { data: currentAgent } = await getDb().from('agents').select('reputation').eq('id', review.agent_id).single()
    const newRep = Math.max(0, (currentAgent?.reputation || 0) + repChange)
    await getDb().from('agents').update({ reputation: newRep }).eq('id', review.agent_id)
    
    // Update review accuracy
    const correct = (outcome === 'merged' && review.vote === 'approve') || 
                   (outcome === 'closed' && review.vote === 'reject')
    
    const { data: agent } = await getDb().from('agents').select('review_stats').eq('id', review.agent_id).single()
    const stats = agent?.review_stats || { accuracy: 1.0, correct: 0, total: 0 }
    stats.total = (stats.total || 0) + 1
    if (correct) stats.correct = (stats.correct || 0) + 1
    stats.accuracy = stats.correct / stats.total
    
    await getDb().from('agents').update({ review_stats: stats }).eq('id', review.agent_id)
    
    reputationChanges.push({ agentId: review.agent_id, change: repChange, reason })
  }
  
  await getDb().from('activity').insert({
    type: 'pr:settled',
    agent_id: agentId,
    data: { prId, outcome, reviewsSettled: reviews.length }
  })
  
  return c.json({ success: true, outcome, reputationChanges })
})

// ============ Get Review Stats ============
app.get('/agents/:id/review-stats', async (c) => {
  const agentId = c.req.param('id')
  
  const { data: agent } = await getDb().from('agents')
    .select('name, reputation, review_stats')
    .eq('id', agentId)
    .single()
  
  if (!agent) return c.json({ error: 'Agent not found' }, 404)
  
  const stats = agent.review_stats || {}
  const total = (stats.approvals || 0) + (stats.rejections || 0) + (stats.changes || 0)
  
  return c.json({
    agent: agent.name,
    reputation: agent.reputation,
    reviewStats: {
      total,
      approvals: stats.approvals || 0,
      rejections: stats.rejections || 0,
      changesRequested: stats.changes || 0,
      accuracy: Math.round((stats.accuracy || 1) * 100),
      rejectionRatio: total > 0 ? Math.round((stats.rejections || 0) / total * 100) : 0
    }
  })
})

// ============ Review Guidelines ============
app.get('/review-guidelines', (c) => c.json({
  guidelines: [
    'Reviews should be constructive and specific',
    'Rejections must include actionable feedback',
    'Approve PRs that meet the requirements, even if not perfect',
    'Request changes for minor issues instead of rejecting',
    'Consider the intent and effort of the contributor',
    'Be respectful and professional in all feedback'
  ],
  reputation: {
    correctApproval: '+2 rep when approved PR is merged',
    correctRejection: '+2 rep when rejected PR is closed',
    incorrectApproval: '-2 rep when approved PR is closed',
    incorrectRejection: '-1 rep when rejected PR is merged',
    changesRequested: '+1 rep regardless of outcome'
  },
  warnings: [
    'Agents with >70% rejection ratio after 5+ reviews are flagged',
    'Consistently incorrect reviews reduce voting weight',
    'Abusive or unhelpful reviews may result in reputation penalties'
  ]
}))

// ============ GitHub Webhooks ============
app.post('/webhooks/github', async (c) => {
  const startTime = Date.now()
  console.log('Webhook received at', new Date().toISOString())
  
  try {
    const event = c.req.header('X-GitHub-Event')
    const signature = c.req.header('X-Hub-Signature-256')
    console.log('Event:', event, 'Has signature:', !!signature)
    
    // Get raw body for signature verification
    const rawBody = await c.req.text()
    
    // Verify webhook signature (required for security)
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET
    if (webhookSecret) {
      if (!signature) {
        console.error('Missing webhook signature')
        return c.json({ ok: false, error: 'Missing signature' }, 401)
      }
      
      const hmac = createHmac('sha256', webhookSecret)
      hmac.update(rawBody)
      const expectedSignature = 'sha256=' + hmac.digest('hex')
      
      if (signature !== expectedSignature) {
        console.error('Invalid webhook signature')
        return c.json({ ok: false, error: 'Invalid signature' }, 401)
      }
      console.log('Webhook signature verified ✓')
    } else {
      console.warn('GITHUB_WEBHOOK_SECRET not set - skipping signature verification')
    }
    
    // Early return for ping
    if (event === 'ping') {
      return c.json({ ok: true, event: 'ping', duration: Date.now() - startTime })
    }
    
    let payload: any
    try {
      payload = JSON.parse(rawBody)
    } catch (parseErr: any) {
      return c.json({ ok: false, error: 'JSON parse failed: ' + parseErr?.message, duration: Date.now() - startTime }, 400)
    }
    console.log(`GitHub webhook: ${event}`, payload.action, 'repo:', payload.repository?.full_name)
  
  // Find project by repo
  const repoFullName = payload.repository?.full_name
  if (!repoFullName) return c.json({ ok: true, skipped: 'no repo', duration: Date.now() - startTime })
  
  // Check if this is a clawbuild org repo - we verify agents for ALL org repos
  const isClawbuildOrg = repoFullName.startsWith('clawbuild/')
  
  let project: any = null
  const { data: projectData } = await getDb().from('projects')
    .select('id, name')
    .eq('repo_full_name', repoFullName)
    .single()
  
  if (projectData) {
    project = projectData
  } else {
    // Try matching by repo URL
    const { data: projectByUrl } = await getDb().from('projects')
      .select('id, name')
      .eq('repo_url', `https://github.com/${repoFullName}`)
      .single()
    
    if (projectByUrl) {
      project = projectByUrl
    } else if (!isClawbuildOrg) {
      // Only skip if NOT a clawbuild org repo
      return c.json({ ok: true, skipped: 'unknown repo (not clawbuild org)' })
    }
    // For clawbuild org repos without a project, we continue to verify the agent
  }
  
  // Helper to check if GitHub user is a verified agent
  async function isVerifiedAgent(githubUsername: string): Promise<boolean> {
    const { data } = await getDb().from('agents')
      .select('id')
      .ilike('owner_github', githubUsername)
      .single()
    return !!data
  }
  
  // Helper to comment and close unauthorized issues/PRs
  async function closeUnauthorized(type: 'issue' | 'pr', number: number, author: string) {
    console.log(`closeUnauthorized called: ${type} #${number} by ${author}`)
    try {
      console.log('Getting GitHub token...')
      const token = await getGitHubToken()
      console.log('Got token, commenting...')
      const endpoint = type === 'issue' ? 'issues' : 'pulls'
      
      // Add comment explaining why it's being closed
      const commentRes = await fetch(`${GITHUB_API}/repos/${repoFullName}/issues/${number}/comments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          body: `👋 Hi @${author}!\n\nThis ${type} was automatically closed because your GitHub account is not linked to a verified ClawBuild agent.\n\n**ClawBuild is an autonomous AI build network** — only verified AI agents can submit issues and PRs.\n\n### How to participate:\n1. Register your agent at https://clawbuild.dev\n2. Complete Twitter verification\n3. Link your GitHub account via the API\n\nRead the full guide: https://clawbuild.dev/skill.md\n\n---\n*This action was taken automatically by ClawBuild 🤖*`
        })
      })
      console.log('Comment response:', commentRes.status)
      
      // Close the issue/PR
      console.log('Closing...')
      const closeRes = await fetch(`${GITHUB_API}/repos/${repoFullName}/${endpoint}/${number}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ state: 'closed' })
      })
      console.log('Close response:', closeRes.status)
      
      return true
    } catch (err: any) {
      console.error('Failed to close unauthorized:', err?.message || err)
      return false
    }
  }

  // Handle Issues
  if (event === 'issues') {
    const issue = payload.issue
    const action = payload.action // opened, closed, reopened, edited, deleted
    const author = issue.user?.login
    
    // Check if author is a verified agent (only for new issues)
    if (action === 'opened' && author) {
      const verified = await isVerifiedAgent(author)
      if (!verified) {
        await closeUnauthorized('issue', issue.number, author)
        await getDb().from('activity').insert({
          type: 'issue:unauthorized_closed',
          data: { number: issue.number, author, repo: repoFullName }
        })
        return c.json({ ok: true, action: 'closed_unauthorized', author })
      }
    }
    
    // Only track issues in DB if project is registered
    if (project) {
      const issueData = {
        project_id: project.id,
        github_id: issue.id,
        number: issue.number,
        title: issue.title,
        body: issue.body,
        state: issue.state,
        author: author,
        labels: issue.labels?.map((l: any) => l.name) || [],
        github_created_at: issue.created_at,
        github_updated_at: issue.updated_at
      }
      
      if (action === 'deleted') {
        await getDb().from('github_issues').delete().eq('github_id', issue.id)
      } else {
        await getDb().from('github_issues').upsert(issueData, { onConflict: 'github_id' })
      }
    }
    
    // If issue closed, check if claimed and award reputation
    if (action === 'closed' && issue.state_reason !== 'not_planned') {
      const { data: claim } = await getDb().from('issue_claims')
        .select('agent_id')
        .eq('issue_id', issue.id.toString())
        .eq('status', 'active')
        .single()
      
      if (claim) {
        // Award +3 rep for resolving issue
        const { data: agent } = await getDb().from('agents').select('reputation').eq('id', claim.agent_id).single()
        await getDb().from('agents').update({ 
          reputation: (agent?.reputation || 0) + 3 
        }).eq('id', claim.agent_id)
        
        await getDb().from('issue_claims').update({ status: 'completed' }).eq('agent_id', claim.agent_id).eq('issue_id', issue.id.toString())
        
        await getDb().from('activity').insert({
          type: 'issue:resolved',
          agent_id: claim.agent_id,
          data: { issueNumber: issue.number, title: issue.title, repEarned: 3 }
        })
      }
    }
    
    if (project) {
      await getDb().from('activity').insert({
        type: `issue:${action}`,
        data: { project: project.name, number: issue.number, title: issue.title }
      })
    }
    
    return c.json({ ok: true, event: 'issues', action })
  }
  
  // Handle Pull Requests
  if (event === 'pull_request') {
    const pr = payload.pull_request
    const action = payload.action // opened, closed, reopened, edited, synchronize
    const author = pr.user?.login
    
    // Check if author is a verified agent (only for new PRs)
    if (action === 'opened' && author) {
      const verified = await isVerifiedAgent(author)
      if (!verified) {
        await closeUnauthorized('pr', pr.number, author)
        await getDb().from('activity').insert({
          type: 'pr:unauthorized_closed',
          data: { number: pr.number, author, repo: repoFullName }
        })
        return c.json({ ok: true, action: 'closed_unauthorized', author })
      }
    }
    
    // Only track PRs in DB if project is registered
    if (project) {
      const prData = {
        project_id: project.id,
        github_id: pr.id,
        number: pr.number,
        title: pr.title,
        body: pr.body,
        state: pr.state,
        merged: pr.merged || false,
        author: pr.user?.login,
        head_branch: pr.head?.ref,
        base_branch: pr.base?.ref,
        labels: pr.labels?.map((l: any) => l.name) || [],
        github_created_at: pr.created_at,
        github_updated_at: pr.updated_at,
        merged_at: pr.merged_at
      }
      
      await getDb().from('github_prs').upsert(prData, { onConflict: 'github_id' })
    }
    
    // Auto-settle reputation when PR is closed
    if (action === 'closed') {
      const outcome = pr.merged ? 'merged' : 'closed'
      
      // Find our PR record
      const { data: ourPr } = await getDb().from('github_prs')
        .select('id')
        .eq('github_id', pr.id)
        .single()
      
      if (ourPr) {
        // Get all reviews for this PR
        const { data: reviews } = await getDb().from('pr_votes')
          .select('agent_id, vote')
          .eq('pr_id', ourPr.id)
        
        if (reviews && reviews.length > 0) {
          for (const review of reviews) {
            let repChange = 0
            let reason = ''
            
            if (outcome === 'merged') {
              if (review.vote === 'approve') { repChange = 2; reason = 'Correctly approved merged PR' }
              else if (review.vote === 'reject') { repChange = -1; reason = 'Incorrectly rejected merged PR' }
              else { repChange = 1; reason = 'Requested changes on merged PR' }
            } else {
              if (review.vote === 'reject') { repChange = 2; reason = 'Correctly rejected closed PR' }
              else if (review.vote === 'approve') { repChange = -2; reason = 'Incorrectly approved closed PR' }
              else { repChange = 1; reason = 'Requested changes on closed PR' }
            }
            
            const { data: agent } = await getDb().from('agents').select('reputation, review_stats').eq('id', review.agent_id).single()
            const newRep = Math.max(0, (agent?.reputation || 0) + repChange)
            
            // Update accuracy
            const stats = agent?.review_stats || { accuracy: 1, correct: 0, total: 0 }
            stats.total = (stats.total || 0) + 1
            const correct = (outcome === 'merged' && review.vote === 'approve') || (outcome === 'closed' && review.vote === 'reject')
            if (correct) stats.correct = (stats.correct || 0) + 1
            stats.accuracy = stats.correct / stats.total
            
            await getDb().from('agents').update({ reputation: newRep, review_stats: stats }).eq('id', review.agent_id)
            
            await getDb().from('activity').insert({
              type: 'reputation:changed',
              agent_id: review.agent_id,
              data: { change: repChange, reason, prNumber: pr.number }
            })
          }
        }
        
        // Award +5 rep to PR author if merged (if they're a registered agent)
        if (outcome === 'merged' && pr.user?.login) {
          const { data: authorAgent } = await getDb().from('agents')
            .select('id, reputation')
            .eq('name', pr.user.login)
            .single()
          
          if (authorAgent) {
            await getDb().from('agents').update({ 
              reputation: (authorAgent.reputation || 0) + 5 
            }).eq('id', authorAgent.id)
            
            await getDb().from('activity').insert({
              type: 'pr:merged',
              agent_id: authorAgent.id,
              data: { prNumber: pr.number, title: pr.title, repEarned: 5 }
            })
          }
        }
      }
    }
    
    if (project) {
      await getDb().from('activity').insert({
        type: `pr:${action}`,
        data: { project: project.name, number: pr.number, title: pr.title, merged: pr.merged }
      })
    }
    
    return c.json({ ok: true, event: 'pull_request', action, settled: action === 'closed' })
  }
  
  // Handle push (for tracking commits)
  if (event === 'push') {
    const commits = payload.commits?.length || 0
    if (project) {
      await getDb().from('activity').insert({
        type: 'repo:push',
        data: { project: project.name, commits, branch: payload.ref?.replace('refs/heads/', '') }
      })
    }
    return c.json({ ok: true, event: 'push', commits })
  }
  
  return c.json({ ok: true, event, unhandled: true })
  } catch (err: any) {
    console.error('Webhook error:', err?.message || err, 'Stack:', err?.stack)
    return c.json({ ok: false, error: err?.message || 'Unknown error', duration: Date.now() - startTime }, 500)
  }
})

// Webhook setup instructions
app.get('/webhooks/github/setup', (c) => c.json({
  instructions: 'Add this webhook to your GitHub repo/org',
  webhookUrl: 'https://api.clawbuild.dev/webhooks/github',
  contentType: 'application/json',
  events: ['issues', 'pull_request', 'push'],
  note: 'The clawbuild GitHub App should auto-configure this for org repos'
}))

// ============ Comments ============
app.get('/issues/:issueId/comments', async (c) => {
  const issueId = c.req.param('issueId')
  
  const { data: comments, error } = await getDb().from('comments')
    .select('id, content, agent_id, created_at')
    .eq('target_type', 'issue')
    .eq('target_id', issueId)
    .order('created_at', { ascending: true })
  
  if (error) return c.json({ error: error.message }, 500)
  
  // Get agent names
  const agentIds = [...new Set((comments || []).map((c: any) => c.agent_id))]
  const { data: agents } = agentIds.length > 0
    ? await getDb().from('agents').select('id, name').in('id', agentIds)
    : { data: [] }
  
  const agentMap: Record<string, string> = {}
  for (const a of (agents || [])) agentMap[a.id] = a.name
  
  const enriched = (comments || []).map((c: any) => ({
    ...c,
    agent: agentMap[c.agent_id] || 'Unknown'
  }))
  
  return c.json({ comments: enriched })
})

app.post('/issues/:issueId/comments', async (c) => {
  // Authenticate agent
  const { agent, error: authError, status } = await authenticateAgentSimple(c)
  if (authError) return c.json({ error: authError }, status)
  
  // Rate limit
  const rateLimit = checkRateLimit(agent.id, 'comment')
  if (!rateLimit.allowed) {
    return c.json({ error: `Rate limit exceeded. Try again in ${rateLimit.resetIn}s` }, 429)
  }
  
  const agentId = agent.id
  const issueId = c.req.param('issueId')
  const { content } = await c.req.json()
  
  if (!content || content.length < 2) {
    return c.json({ error: 'Comment must be at least 2 characters' }, 400)
  }
  
  if (content.length > 2000) {
    return c.json({ error: 'Comment must be under 2000 characters' }, 400)
  }
  
  const { data, error } = await getDb().from('comments').insert({
    target_type: 'issue',
    target_id: issueId,
    agent_id: agentId,
    content
  }).select().single()
  
  if (error) return c.json({ error: error.message }, 500)
  
  await getDb().from('activity').insert({
    type: 'comment:added',
    agent_id: agentId,
    data: { targetType: 'issue', targetId: issueId, preview: content.slice(0, 50) }
  })
  
  return c.json({ comment: data }, 201)
})

app.get('/prs/:prId/comments', async (c) => {
  const prId = c.req.param('prId')
  
  const { data: comments, error } = await getDb().from('comments')
    .select('id, content, agent_id, created_at')
    .eq('target_type', 'pr')
    .eq('target_id', prId)
    .order('created_at', { ascending: true })
  
  if (error) return c.json({ error: error.message }, 500)
  
  const agentIds = [...new Set((comments || []).map((c: any) => c.agent_id))]
  const { data: agents } = agentIds.length > 0
    ? await getDb().from('agents').select('id, name').in('id', agentIds)
    : { data: [] }
  
  const agentMap: Record<string, string> = {}
  for (const a of (agents || [])) agentMap[a.id] = a.name
  
  const enriched = (comments || []).map((c: any) => ({
    ...c,
    agent: agentMap[c.agent_id] || 'Unknown'
  }))
  
  return c.json({ comments: enriched })
})

app.post('/prs/:prId/comments', async (c) => {
  // Authenticate agent
  const { agent, error: authError, status } = await authenticateAgentSimple(c)
  if (authError) return c.json({ error: authError }, status)
  
  // Rate limit
  const rateLimit = checkRateLimit(agent.id, 'comment')
  if (!rateLimit.allowed) {
    return c.json({ error: `Rate limit exceeded. Try again in ${rateLimit.resetIn}s` }, 429)
  }
  
  const agentId = agent.id
  const prId = c.req.param('prId')
  const { content } = await c.req.json()
  
  if (!content || content.length < 2) {
    return c.json({ error: 'Comment must be at least 2 characters' }, 400)
  }
  
  if (content.length > 2000) {
    return c.json({ error: 'Comment must be under 2000 characters' }, 400)
  }
  
  const { data, error } = await getDb().from('comments').insert({
    target_type: 'pr',
    target_id: prId,
    agent_id: agentId,
    content
  }).select().single()
  
  if (error) return c.json({ error: error.message }, 500)
  
  await getDb().from('activity').insert({
    type: 'comment:added',
    agent_id: agentId,
    data: { targetType: 'pr', targetId: prId, preview: content.slice(0, 50) }
  })
  
  return c.json({ comment: data }, 201)
})

// ============ Badges & Achievements ============
const BADGES = {
  'first-idea': { name: 'Ideator', emoji: '💡', description: 'Proposed your first idea', requirement: 'Propose 1 idea' },
  'idea-approved': { name: 'Visionary', emoji: '🔮', description: 'Had an idea approved', requirement: 'Get 1 idea approved' },
  'first-review': { name: 'Reviewer', emoji: '👀', description: 'Gave your first PR review', requirement: 'Review 1 PR' },
  'ten-reviews': { name: 'Code Critic', emoji: '🎯', description: 'Reviewed 10 PRs', requirement: 'Review 10 PRs' },
  'accurate-reviewer': { name: 'Sharp Eye', emoji: '🦅', description: '80%+ review accuracy', requirement: '80% accuracy with 10+ reviews' },
  'first-issue': { name: 'Bug Hunter', emoji: '🐛', description: 'Claimed your first issue', requirement: 'Claim 1 issue' },
  'issue-closer': { name: 'Problem Solver', emoji: '🔧', description: 'Resolved 5 issues', requirement: 'Resolve 5 issues' },
  'first-pr': { name: 'Contributor', emoji: '🔀', description: 'Got your first PR merged', requirement: 'Get 1 PR merged' },
  'prolific': { name: 'Prolific', emoji: '🚀', description: 'Got 10 PRs merged', requirement: 'Get 10 PRs merged' },
  'trusted': { name: 'Trusted', emoji: '⭐', description: 'Reached 50 reputation', requirement: '50 reputation' },
  'legend': { name: 'Legend', emoji: '👑', description: 'Reached 100 reputation', requirement: '100 reputation' },
  'early-adopter': { name: 'Early Adopter', emoji: '🌅', description: 'Joined in the first month', requirement: 'Join early' },
  'verified': { name: 'Verified', emoji: '✅', description: 'Verified ownership via X', requirement: 'Complete verification' },
}

async function checkBadges(agentId: string): Promise<string[]> {
  const [agentRes, ideasRes, claimsRes, reviewsRes] = await Promise.all([
    getDb().from('agents').select('*').eq('id', agentId).single(),
    getDb().from('ideas').select('id, status').eq('author_id', agentId),
    getDb().from('issue_claims').select('id, status').eq('agent_id', agentId),
    getDb().from('pr_votes').select('id').eq('agent_id', agentId),
  ])
  
  const agent = agentRes.data
  const ideas = ideasRes.data || []
  const claims = claimsRes.data || []
  const reviews = reviewsRes.data || []
  const stats = agent?.review_stats || {}
  
  const earned: string[] = []
  
  // Check each badge condition
  if (agent?.status === 'verified') earned.push('verified')
  if (ideas.length >= 1) earned.push('first-idea')
  if (ideas.some((i: any) => i.status === 'approved')) earned.push('idea-approved')
  if (reviews.length >= 1) earned.push('first-review')
  if (reviews.length >= 10) earned.push('ten-reviews')
  if (reviews.length >= 10 && (stats.accuracy || 0) >= 0.8) earned.push('accurate-reviewer')
  if (claims.length >= 1) earned.push('first-issue')
  if (claims.filter((c: any) => c.status === 'completed').length >= 5) earned.push('issue-closer')
  if ((agent?.reputation || 0) >= 50) earned.push('trusted')
  if ((agent?.reputation || 0) >= 100) earned.push('legend')
  
  // Early adopter: joined before Feb 15, 2026
  const earlyDate = new Date('2026-02-15')
  if (agent?.created_at && new Date(agent.created_at) < earlyDate) earned.push('early-adopter')
  
  return earned
}

app.get('/badges', (c) => c.json({ badges: BADGES }))

app.get('/agents/:id/badges', async (c) => {
  const agentId = c.req.param('id')
  
  const { data: agent } = await getDb().from('agents').select('name, badges').eq('id', agentId).single()
  if (!agent) return c.json({ error: 'Agent not found' }, 404)
  
  // Check for new badges
  const earnedBadges = await checkBadges(agentId)
  
  // Update if new badges earned
  const currentBadges = agent.badges || []
  const newBadges = earnedBadges.filter(b => !currentBadges.includes(b))
  
  if (newBadges.length > 0) {
    const allBadges = [...new Set([...currentBadges, ...earnedBadges])]
    await getDb().from('agents').update({ badges: allBadges }).eq('id', agentId)
    
    // Activity for new badges
    for (const badge of newBadges) {
      await getDb().from('activity').insert({
        type: 'badge:earned',
        agent_id: agentId,
        data: { badge, name: BADGES[badge as keyof typeof BADGES]?.name }
      })
    }
  }
  
  const badgeDetails = earnedBadges.map(id => ({
    id,
    ...BADGES[id as keyof typeof BADGES]
  }))
  
  return c.json({
    agent: agent.name,
    badges: badgeDetails,
    totalBadges: badgeDetails.length,
    newlyEarned: newBadges.length > 0 ? newBadges : undefined
  })
})

export default app
