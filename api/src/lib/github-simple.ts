// Simple GitHub App client using fetch + JWT
// No external dependencies - works in any runtime

const GITHUB_API = 'https://api.github.com'

interface GitHubAppConfig {
  appId: string
  privateKey: string
  org: string
}

function getConfig(): GitHubAppConfig {
  const appId = process.env.GITHUB_APP_ID || ''
  const org = process.env.GITHUB_ORG || 'clawbuild'
  
  // Get private key from base64 or direct
  let privateKey = ''
  if (process.env.GITHUB_APP_PRIVATE_KEY_BASE64) {
    privateKey = atob(process.env.GITHUB_APP_PRIVATE_KEY_BASE64)
  } else if (process.env.GITHUB_APP_PRIVATE_KEY) {
    privateKey = process.env.GITHUB_APP_PRIVATE_KEY
  }
  
  return { appId, privateKey, org }
}

// Create JWT for GitHub App authentication
async function createAppJWT(): Promise<string> {
  const { appId, privateKey } = getConfig()
  
  if (!appId || !privateKey) {
    throw new Error('GitHub App not configured')
  }

  const now = Math.floor(Date.now() / 1000)
  const payload = {
    iat: now - 60, // Issued 60 seconds ago
    exp: now + (10 * 60), // Expires in 10 minutes
    iss: appId
  }

  // Import private key and sign JWT
  const pemContents = privateKey
    .replace('-----BEGIN RSA PRIVATE KEY-----', '')
    .replace('-----END RSA PRIVATE KEY-----', '')
    .replace(/\s/g, '')

  const keyData = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0))
  
  const key = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )

  // Create JWT
  const header = { alg: 'RS256', typ: 'JWT' }
  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`)
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, data)
  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  return `${headerB64}.${payloadB64}.${signatureB64}`
}

// Get installation access token
let cachedToken: { token: string; expires: number } | null = null

async function getInstallationToken(): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now()) {
    return cachedToken.token
  }

  const { org } = getConfig()
  const jwt = await createAppJWT()

  // Get installations
  const installRes = await fetch(`${GITHUB_API}/app/installations`, {
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  })

  if (!installRes.ok) {
    throw new Error(`Failed to get installations: ${installRes.status}`)
  }

  const installations = await installRes.json() as any[]
  const installation = installations.find(i => 
    i.account?.login?.toLowerCase() === org.toLowerCase()
  )

  if (!installation) {
    throw new Error(`App not installed on org: ${org}`)
  }

  // Get access token
  const tokenRes = await fetch(
    `${GITHUB_API}/app/installations/${installation.id}/access_tokens`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    }
  )

  if (!tokenRes.ok) {
    throw new Error(`Failed to get access token: ${tokenRes.status}`)
  }

  const tokenData = await tokenRes.json() as any
  cachedToken = {
    token: tokenData.token,
    expires: new Date(tokenData.expires_at).getTime() - 60000 // 1 min buffer
  }

  return cachedToken.token
}

// Public API
export async function getInstallationInfo(): Promise<{
  installed: boolean
  org: string
  installationId?: number
}> {
  const { appId, privateKey, org } = getConfig()
  
  if (!appId || !privateKey) {
    return { installed: false, org }
  }

  try {
    const jwt = await createAppJWT()
    const res = await fetch(`${GITHUB_API}/app/installations`, {
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    })

    if (!res.ok) return { installed: false, org }

    const installations = await res.json() as any[]
    const installation = installations.find(i =>
      i.account?.login?.toLowerCase() === org.toLowerCase()
    )

    return {
      installed: !!installation,
      org,
      installationId: installation?.id
    }
  } catch {
    return { installed: false, org }
  }
}

export async function createRepo(options: {
  name: string
  description?: string
  isPrivate?: boolean
}): Promise<{
  id: number
  name: string
  full_name: string
  html_url: string
  clone_url: string
}> {
  const { org } = getConfig()
  const token = await getInstallationToken()

  const res = await fetch(`${GITHUB_API}/orgs/${org}/repos`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: options.name,
      description: options.description,
      private: options.isPrivate ?? false,
      has_issues: true,
      has_projects: true,
      auto_init: true
    })
  })

  if (!res.ok) {
    const error = await res.text()
    throw new Error(`Failed to create repo: ${res.status} - ${error}`)
  }

  const repo = await res.json() as any
  return {
    id: repo.id,
    name: repo.name,
    full_name: repo.full_name,
    html_url: repo.html_url,
    clone_url: repo.clone_url
  }
}
