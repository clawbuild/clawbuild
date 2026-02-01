// Ed25519 signature verification using Web Crypto API
// Works in Node.js 18+, Edge, and browsers

export async function verifySignature(
  message: string,
  signatureBase64: string,
  publicKeyBase64: string
): Promise<boolean> {
  try {
    // Decode base64
    const signature = Uint8Array.from(atob(signatureBase64), c => c.charCodeAt(0))
    const publicKeyBytes = Uint8Array.from(atob(publicKeyBase64), c => c.charCodeAt(0))
    const messageBytes = new TextEncoder().encode(message)

    // Import public key
    const publicKey = await crypto.subtle.importKey(
      'raw',
      publicKeyBytes,
      { name: 'Ed25519' },
      false,
      ['verify']
    )

    // Verify signature
    const valid = await crypto.subtle.verify(
      'Ed25519',
      publicKey,
      signature,
      messageBytes
    )

    return valid
  } catch (err) {
    console.error('Signature verification failed:', err)
    return false
  }
}

export async function generateKeyPair(): Promise<{
  publicKey: string
  privateKey: string
}> {
  const keyPair = await crypto.subtle.generateKey(
    'Ed25519',
    true,
    ['sign', 'verify']
  )

  const publicKeyBytes = await crypto.subtle.exportKey('raw', keyPair.publicKey)
  const privateKeyBytes = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)

  return {
    publicKey: btoa(String.fromCharCode(...new Uint8Array(publicKeyBytes))),
    privateKey: btoa(String.fromCharCode(...new Uint8Array(privateKeyBytes)))
  }
}

export function sha256(data: string): string {
  // Use Node.js crypto for hashing (sync operation)
  const { createHash } = require('crypto')
  return createHash('sha256').update(data).digest('hex')
}
