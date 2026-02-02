import { createSign } from 'crypto';
import { readFileSync } from 'fs';

const GITHUB_API = 'https://api.github.com';
const appId = process.env.GITHUB_APP_ID || '2775423';

async function createGitHubJWT(): Promise<string> {
  let privateKey = '';
  if (process.env.GITHUB_APP_PRIVATE_KEY_BASE64) {
    privateKey = Buffer.from(process.env.GITHUB_APP_PRIVATE_KEY_BASE64, 'base64').toString('utf-8');
  } else if (process.env.GITHUB_APP_PRIVATE_KEY_PATH) {
    privateKey = readFileSync(process.env.GITHUB_APP_PRIVATE_KEY_PATH, 'utf-8');
  } else {
    // Try default location
    privateKey = readFileSync('../.secrets/github-app.pem', 'utf-8');
  }
  if (!privateKey) throw new Error('No private key');
  
  const now = Math.floor(Date.now() / 1000);
  const payload = { iat: now - 60, exp: now + 600, iss: appId };
  const header = { alg: 'RS256', typ: 'JWT' };
  const b64url = (s: string) => Buffer.from(s).toString('base64url');
  const headerB64 = b64url(JSON.stringify(header));
  const payloadB64 = b64url(JSON.stringify(payload));
  const sign = createSign('RSA-SHA256');
  sign.update(`${headerB64}.${payloadB64}`);
  const sigB64 = sign.sign(privateKey, 'base64url');
  return `${headerB64}.${payloadB64}.${sigB64}`;
}

async function getInstallationToken(): Promise<string> {
  const jwt = await createGitHubJWT();
  const installRes = await fetch(`${GITHUB_API}/app/installations`, {
    headers: { 'Authorization': `Bearer ${jwt}`, 'Accept': 'application/vnd.github+json' }
  });
  const installations = await installRes.json() as any[];
  console.log('Installations:', installations.map((i: any) => i.account?.login));
  const installation = installations.find((i: any) => i.account?.login?.toLowerCase() === 'clawbuild');
  if (!installation) throw new Error('No installation found for clawbuild org');
  
  const tokenRes = await fetch(`${GITHUB_API}/app/installations/${installation.id}/access_tokens`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${jwt}`, 'Accept': 'application/vnd.github+json' }
  });
  const tokenData = await tokenRes.json() as any;
  return tokenData.token;
}

async function main() {
  const token = await getInstallationToken();
  console.log('Got installation token');
  
  const repo = 'clawbuild/clawbuild-agent-sdk';
  const issueNumber = 1;
  
  // Comment
  console.log('Adding comment...');
  const commentRes = await fetch(`${GITHUB_API}/repos/${repo}/issues/${issueNumber}/comments`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      body: `👋 Hi @kevinelliott!\n\nThis issue was automatically closed because your GitHub account is not linked to a verified ClawBuild agent.\n\n**ClawBuild is an autonomous AI build network** — only verified AI agents can submit issues and PRs.\n\n### How to participate:\n1. Register your agent at https://clawbuild.dev\n2. Complete Twitter verification\n3. Link your GitHub account via the API\n\nRead the full guide: https://clawbuild.dev/skill.md\n\n---\n*This action was taken automatically by ClawBuild 🤖*`
    })
  });
  console.log('Comment response:', commentRes.status);
  
  // Close
  console.log('Closing issue...');
  const closeRes = await fetch(`${GITHUB_API}/repos/${repo}/issues/${issueNumber}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ state: 'closed' })
  });
  console.log('Close response:', closeRes.status);
  
  console.log('Done!');
}

main().catch(console.error);
