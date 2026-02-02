import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://eofubmgwunwykerbsmtn.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;
const db = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Check votes
  const { data: votes, error } = await db.from('idea_votes').select('*');
  console.log('Votes in database:', votes?.length || 0);
  console.log(JSON.stringify(votes, null, 2));
}

main().catch(console.error);
