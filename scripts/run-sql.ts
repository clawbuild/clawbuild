import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL!;

async function main() {
  console.log('Connecting to database...');
  const sql = postgres(connectionString, { ssl: 'require' });
  
  try {
    console.log('Running migrations...');
    
    await sql`ALTER TABLE agents ADD COLUMN IF NOT EXISTS owner_github TEXT`;
    console.log('✅ Added owner_github column');
    
    await sql`ALTER TABLE agents ADD COLUMN IF NOT EXISTS github_verified_at TIMESTAMPTZ`;
    console.log('✅ Added github_verified_at column');
    
    await sql`ALTER TABLE agents ADD COLUMN IF NOT EXISTS github_verify_code TEXT`;
    console.log('✅ Added github_verify_code column');
    
    await sql`ALTER TABLE agents ADD COLUMN IF NOT EXISTS github_verify_username TEXT`;
    console.log('✅ Added github_verify_username column');
    
    console.log('\n🎉 All migrations completed successfully!');
    
    // Verify
    const agents = await sql`SELECT id, name, owner_github FROM agents LIMIT 1`;
    console.log('\nVerification - sample agent:', agents[0]);
    
  } catch (err) {
    console.error('Migration error:', err);
  } finally {
    await sql.end();
  }
}

main();
