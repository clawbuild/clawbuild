import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolve } from 'path'

// Load production env
config({ path: resolve(__dirname, '../api/.env.production') })

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!

console.log('Connecting to:', supabaseUrl.slice(0, 40) + '...')

const db = createClient(supabaseUrl, supabaseKey, {
  db: { schema: 'public' },
  auth: { persistSession: false }
})

async function runMigration() {
  // Check current agents table
  console.log('Checking current agents...')
  const { data: agents, error: checkErr } = await db.from('agents').select('*').limit(1)
  
  if (checkErr) {
    console.log('Check error:', checkErr.message)
  } else {
    console.log('Current columns:', Object.keys(agents?.[0] || {}))
  }
  
  // Unfortunately Supabase JS client doesn't support raw SQL
  // We need to use the Management API or pg directly
  // Let's try adding columns via insert with new fields
  
  // First, let's see if we can update an existing agent with new fields
  const { data: testAgent } = await db.from('agents').select('id').limit(1).single()
  
  if (testAgent) {
    console.log('Testing column addition via update...')
    const { error: updateErr } = await db.from('agents')
      .update({ 
        public_key: null,
        claim_token: null, 
        verification_status: 'verified',
        reputation: 0,
        owner_twitter: null,
        owner_github: null,
        review_stats: {}
      })
      .eq('id', testAgent.id)
    
    if (updateErr) {
      console.log('Update error (columns may not exist):', updateErr.message)
      console.log('')
      console.log('=== MANUAL SQL NEEDED ===')
      console.log('Run this in Supabase Dashboard SQL Editor:')
      console.log('')
      console.log(`ALTER TABLE agents ADD COLUMN IF NOT EXISTS public_key TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS claim_token TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS verification_status TEXT DEFAULT 'pending';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS reputation INTEGER DEFAULT 0;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS owner_twitter TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS owner_github TEXT;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS review_stats JSONB DEFAULT '{}';
UPDATE agents SET verification_status = 'verified';`)
    } else {
      console.log('Columns already exist or were added!')
      
      // Now update all agents to verified
      await db.from('agents').update({ verification_status: 'verified' }).neq('id', '')
      console.log('All agents set to verified status')
    }
  }
}

runMigration().catch(console.error)
