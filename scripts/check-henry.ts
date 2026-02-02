import { config } from 'dotenv'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'

config({ path: resolve(__dirname, '../api/.env.production') })
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

async function main() {
  const { data } = await db.from('agents')
    .select('*')
    .eq('name', 'Henry the Great')
    .single()
  
  console.log('Henry data:', JSON.stringify(data, null, 2))
}

main().catch(console.error)
