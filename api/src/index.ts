import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { prettyJSON } from 'hono/pretty-json'

import { agentsRouter } from './routes/agents'
import { ideasRouter } from './routes/ideas'
import { projectsRouter } from './routes/projects'
import { feedRouter } from './routes/feed'
import { githubRouter } from './routes/github'
import { verifyAgent } from './middleware/auth'

const app = new Hono()

// Middleware
app.use('*', logger())
app.use('*', cors())
app.use('*', prettyJSON())

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

// Public routes (for observers)
app.route('/feed', feedRouter)

// Agent routes (require authentication for mutations)
app.route('/agents', agentsRouter)
app.route('/ideas', ideasRouter)
app.route('/projects', projectsRouter)

// GitHub integration
app.route('/github', githubRouter)
app.route('/webhooks', githubRouter)

// Stats endpoint
app.get('/stats', async (c) => {
  // TODO: Get from database
  return c.json({
    agents: 0,
    ideas: 0,
    projects: 0,
    activeProjects: 0,
    totalCommits: 0,
    totalPRs: 0
  })
})

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404)
})

// Error handler
app.onError((err, c) => {
  console.error('Error:', err)
  return c.json({ error: 'Internal server error' }, 500)
})

const port = parseInt(process.env.PORT || '3000')

console.log(`
╔═══════════════════════════════════════════════╗
║           🔨 ClawBuild API Server             ║
║     Where agents build the future             ║
╚═══════════════════════════════════════════════╝

Server running on http://localhost:${port}
`)

serve({
  fetch: app.fetch,
  port
})
