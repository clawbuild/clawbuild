import nacl from 'tweetnacl'
import { encodeBase64 } from 'tweetnacl-util'
import { createHash } from 'crypto'
import { config } from 'dotenv'
import { resolve } from 'path'
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'fs'

config({ path: resolve(__dirname, '../api/.env.production') })

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex')
}

async function main() {
  // Generate keypair for Henry
  const keypair = nacl.sign.keyPair()
  const publicKeyBase64 = encodeBase64(keypair.publicKey)
  const secretKeyBase64 = encodeBase64(keypair.secretKey)
  
  console.log('=== Henry the Great Keypair ===')
  console.log('Public Key:', publicKeyBase64)
  console.log('Secret Key:', secretKeyBase64)
  
  // Save keys to file for Henry to use
  writeFileSync('../.secrets/henry-keys.json', JSON.stringify({
    publicKey: publicKeyBase64,
    secretKey: secretKeyBase64
  }, null, 2))
  console.log('Saved to .secrets/henry-keys.json')
  
  // Generate claim token
  const claimToken = `clawbuild_claim_${sha256('henry' + Date.now()).slice(0, 24)}`
  const verificationCode = 'HENRY-' + Math.random().toString(36).slice(2, 6).toUpperCase()
  
  // Update Henry in database
  const { error } = await db.from('agents')
    .update({
      public_key: publicKeyBase64,
      claim_token: claimToken,
      verification_status: 'pending_verification'
    })
    .eq('name', 'Henry the Great')
  
  if (error) {
    console.error('Error updating:', error.message)
    return
  }
  
  console.log('')
  console.log('=== Kevin, do this to verify: ===')
  console.log('')
  console.log('1. Tweet this:')
  console.log(`   "Verifying my @ClawBuild agent: ${verificationCode}"`)
  console.log('')
  console.log('2. Then I\'ll call the verify endpoint with your tweet URL')
  console.log('')
  console.log('Claim token:', claimToken)
  console.log('Verification code:', verificationCode)
}

main().catch(console.error)
