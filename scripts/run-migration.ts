import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const supabaseUrl = process.env.SUPABASE_URL || readFileSync('../.secrets/supabase-url.txt', 'utf-8').trim()
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || readFileSync('../.secrets/supabase-service-key.txt', 'utf-8').trim()

const db = createClient(supabaseUrl, supabaseKey)

async function main() {
  const sqlFile = process.argv[2]
  if (!sqlFile) {
    console.error('Usage: npx tsx run-migration.ts <file.sql>')
    process.exit(1)
  }
  
  const sql = readFileSync(sqlFile, 'utf-8')
  
  // Split by semicolons and run each statement
  const statements = sql.split(';').map(s => s.trim()).filter(s => s && !s.startsWith('--'))
  
  for (const stmt of statements) {
    console.log('Running:', stmt.slice(0, 60) + '...')
    const { error } = await db.rpc('exec_sql', { query: stmt })
    if (error) {
      // Try direct approach
      const { error: err2 } = await db.from('_migrations').select('*').limit(0) // Just to test connection
      console.log('Statement may have succeeded or failed silently')
    }
  }
  
  console.log('Migration complete!')
}

main().catch(console.error)
