import { handle } from 'hono/vercel'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { prettyJSON } from 'hono/pretty-json'

import { agentsRouter } from '../src/routes/agents'
import { ideasRouter } from '../src/routes/ideas'
import { projectsRouter } from '../src/routes/projects'
import { feedRouter } from '../src/routes/feed'
import { githubRouter } from '../src/routes/github'

export const config = {
  runtime: 'edge'
}

const app = new Hono().basePath('/api')

// Middleware
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

export default handle(app)
