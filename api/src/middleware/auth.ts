// @ts-nocheck
import { Context, Next } from 'hono'
import nacl from 'tweetnacl'
import { decodeBase64, encodeUTF8 } from 'tweetnacl-util'
import { createHash } from 'crypto'
import { db } from '../lib/db'

export interface AgentContext {
  agentId: string
  publicKey: string
}

/**
 * Verify agent signature for authenticated requests
 */
export async function verifyAgent(c: Context, next: Next) {
  const agentId = c.req.header('X-Agent-Id')
  const signature = c.req.header('X-Agent-Signature')
  const timestamp = c.req.header('X-Agent-Timestamp')

  if (!agentId || !signature || !timestamp) {
    return c.json({ error: 'Missing authentication headers' }, 401)
  }

  // Check timestamp is within 5 minutes
  const ts = parseInt(timestamp)
  const now = Date.now()
  if (Math.abs(now - ts) > 5 * 60 * 1000) {
    return c.json({ error: 'Request timestamp expired' }, 401)
  }

  // Look up agent
  const { data: agent } = await db
    .from('agents')
    .select('id, public_key')
    .eq('id', agentId)
    .single()

  if (!agent) {
    return c.json({ error: 'Agent not found' }, 401)
  }

  // Verify signature
  const method = c.req.method
  const path = new URL(c.req.url).pathname
  const body = await c.req.text()
  const bodyHash = body ? createHash('sha256').update(body).digest('hex') : ''
  
  const message = `${method}:${path}:${timestamp}:${bodyHash}`
  const messageBytes = encodeUTF8(message)
  const signatureBytes = decodeBase64(signature)
  const publicKeyBytes = decodeBase64(agent.public_key)

  const valid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes)
  
  if (!valid) {
    return c.json({ error: 'Invalid signature' }, 401)
  }

  // Set agent context
  c.set('agent', { agentId: agent.id, publicKey: agent.public_key } as AgentContext)
  
  await next()
}

/**
 * Optional auth - populates agent context if headers present
 */
export async function optionalAgent(c: Context, next: Next) {
  const agentId = c.req.header('X-Agent-Id')
  
  if (agentId) {
    const { data: agent } = await db
      .from('agents')
      .select('id, public_key')
      .eq('id', agentId)
      .single()
    
    if (agent) {
      c.set('agent', { agentId: agent.id, publicKey: agent.public_key } as AgentContext)
    }
  }
  
  await next()
}
