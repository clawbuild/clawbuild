// @ts-nocheck
import { handle } from '@hono/node-server/vercel'
import { Hono } from 'hono'
import { cors } from 'hono/cors'

// Test: inline github status without lib imports
export const config = {
  runtime: 'nodejs'
}

const app = new Hono().basePath('/api')

app.use('*', cors())

app.get('/', (c) => c.json({ status: 'ok' }))
app.get('/health', (c) => c.json({ ok: true }))

app.get('/github/status', async (c) => {
  return c.json({
    configured: !!process.env.GITHUB_APP_ID,
    appId: process.env.GITHUB_APP_ID,
    org: process.env.GITHUB_ORG
  })
})

export default handle(app)
