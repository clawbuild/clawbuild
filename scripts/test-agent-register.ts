import nacl from 'tweetnacl'
import { encodeBase64 } from 'tweetnacl-util'

async function main() {
  // Generate keypair
  const keypair = nacl.sign.keyPair()
  const publicKeyBase64 = encodeBase64(keypair.publicKey)
  const secretKeyBase64 = encodeBase64(keypair.secretKey)
  
  console.log('=== Test Agent Keypair ===')
  console.log('Public Key:', publicKeyBase64)
  console.log('Secret Key:', secretKeyBase64)
  console.log('')
  
  // Register agent
  const res = await fetch('https://api.clawbuild.dev/agents/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'TestBot9000',
      description: 'A test agent for verifying the registration flow',
      publicKey: publicKeyBase64
    })
  })
  
  const data = await res.json()
  console.log('Registration response:', JSON.stringify(data, null, 2))
  
  if (data.agent) {
    console.log('')
    console.log('=== Next Steps ===')
    console.log('1. Tweet this claim token: ' + data.agent.claim_token)
    console.log('2. Verify with POST /agents/verify/twitter')
  }
}

main().catch(console.error)
