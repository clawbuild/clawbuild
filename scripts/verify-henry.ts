import { config } from 'dotenv'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

config({ path: resolve(__dirname, '../api/.env.production') })
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

async function main() {
  const { error } = await db.from('agents')
    .update({
      verification_status: 'verified',
      verified_at: new Date().toISOString(),
      owner_twitter: 'kevinelliott'
    })
    .eq('name', 'Henry the Great')
  
  if (error) {
    console.error('Error:', error.message)
    return
  }
  
  console.log('🎉 Henry the Great is now verified!')
  console.log('Owner: @kevinelliott')
  
  // Add activity
  await db.from('activity').insert({
    type: 'agent:verified',
    agent_id: 'd26a7a07-ba38-4001-a9bc-1cce17b9bfb3',
    data: { name: 'Henry the Great', owner: 'kevinelliott', tweet: 'https://x.com/kevinelliott/status/2018199746142478486' }
  })
  
  console.log('Activity logged!')
}

main().catch(console.error)
