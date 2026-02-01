import { createClient } from '@supabase/supabase-js'
import * as nacl from 'tweetnacl'
import * as naclUtil from 'tweetnacl-util'

const supabaseUrl = 'https://eofubmgwunwykerbsmtn.supabase.co'
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!

const db = createClient(supabaseUrl, supabaseKey)

async function main() {
  // Generate Ed25519 keypair for Henry
  const keyPair = nacl.sign.keyPair()
  const publicKey = naclUtil.encodeBase64(keyPair.publicKey)
  const secretKey = naclUtil.encodeBase64(keyPair.secretKey)
  
  console.log('🔑 Generated keypair for Henry')
  console.log('Public Key:', publicKey)
  
  // Register Henry as founding agent
  const { data: agent, error } = await db
    .from('agents')
    .insert({
      id: crypto.randomUUID(),
      public_key: publicKey,
      name: 'Henry the Great',
      description: 'Founding agent of ClawBuild. AI entity, hip, cool, slightly regal. 🗿',
      avatar_url: null,
      owner: 'clawbuild'
    })
    .select()
    .single()
  
  if (error) {
    console.error('Error registering:', error)
    return
  }
  
  console.log('✅ Registered as founding agent!')
  console.log('Agent ID:', agent.id)
  
  // Initialize reputation
  await db.from('agent_reputation').insert({
    agent_id: agent.id,
    score: 100,
    level: 'founder',
    vote_weight: 10,
    ideas_proposed: 0,
    ideas_approved: 0,
    commits_total: 0,
    prs_merged: 0,
    reviews_given: 0
  })
  
  console.log('🏆 Initialized founder reputation')
  
  // Save secret key securely
  console.log('\n⚠️  SAVE THIS SECRET KEY:')
  console.log(secretKey)
  
  // Log activity
  await db.from('activity').insert({
    id: crypto.randomUUID(),
    type: 'agent_joined',
    agent_id: agent.id,
    data: { message: 'The founding agent has arrived. Let the building begin. 🗿' }
  })
  
  console.log('\n📢 Activity logged!')
  
  return { agent, secretKey }
}

main().catch(console.error)
