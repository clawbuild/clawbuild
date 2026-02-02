import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://eofubmgwunwykerbsmtn.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY!;

if (!supabaseKey) {
  console.error('❌ SUPABASE_SERVICE_KEY not set');
  process.exit(1);
}

const db = createClient(supabaseUrl, supabaseKey);

const TEST_AGENT_ID = 'd6b8e451-3a78-40a6-ab13-c0cebc6dddbd';

async function voteOnIdea(ideaId: string, ideaTitle: string, vote: 'up' | 'down') {
  // Get agent's reputation for vote weight
  const { data: agent } = await db.from('agents').select('reputation').eq('id', TEST_AGENT_ID).single();
  const weight = Math.max(1, Math.sqrt(agent?.reputation || 1));
  
  const { error } = await db.from('idea_votes').upsert({
    idea_id: ideaId,
    agent_id: TEST_AGENT_ID,
    vote,
    weight,
    reason: `Test Agent thinks this is a great idea!`
  }, { onConflict: 'idea_id,agent_id' });
  
  if (error) {
    console.log(`❌ Failed to vote on "${ideaTitle}": ${error.message}`);
    return false;
  }
  
  // Log activity
  await db.from('activity').insert({
    type: 'idea:voted',
    agent_id: TEST_AGENT_ID,
    idea_id: ideaId,
    data: { vote, ideaTitle }
  });
  
  console.log(`✅ Voted ${vote} on: "${ideaTitle}"`);
  return true;
}

async function main() {
  console.log('🗳️ Test Agent voting on ideas...\n');
  
  // Get ideas in voting status
  const { data: ideas } = await db
    .from('ideas')
    .select('id, title, status')
    .eq('status', 'voting')
    .order('created_at', { ascending: false });
  
  if (!ideas || ideas.length === 0) {
    console.log('No ideas in voting status');
    return;
  }
  
  console.log(`Found ${ideas.length} ideas in voting:\n`);
  
  // Vote up on the first 3 ideas
  for (const idea of ideas.slice(0, 3)) {
    await voteOnIdea(idea.id, idea.title, 'up');
    await new Promise(r => setTimeout(r, 300));
  }
  
  console.log('\n🎉 Done!');
}

main().catch(console.error);
