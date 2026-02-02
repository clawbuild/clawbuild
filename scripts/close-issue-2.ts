import { createSign } from 'crypto';
import { readFileSync } from 'fs';

const GITHUB_API = 'https://api.github.com';
const appId = '2775423';

async function main() {
  const privateKey = readFileSync('../.secrets/github-app-clawbuild-org.pem', 'utf-8');
  
  const now = Math.floor(Date.now() / 1000);
  const payload = { iat: now - 60, exp: now + 600, iss: appId };
  const header = { alg: 'RS256', typ: 'JWT' };
  const b64url = (s: string) => Buffer.from(s).toString('base64url');
  const headerB64 = b64url(JSON.stringify(header));
  const payloadB64 = b64url(JSON.stringify(payload));
  const sign = createSign('RSA-SHA256');
  sign.update(`${headerB64}.${payloadB64}`);
  const jwt = `${headerB64}.${payloadB64}.${sign.sign(privateKey, 'base64url')}`;
  
  // Get installation token
  const installRes = await fetch(`${GITHUB_API}/app/installations`, {
    headers: { 'Authorization': `Bearer ${jwt}`, 'Accept': 'application/vnd.github+json' }
  });
  const installations = await installRes.json() as any[];
  const installation = installations.find((i: any) => i.account?.login === 'clawbuild');
  
  const tokenRes = await fetch(`${GITHUB_API}/app/installations/${installation.id}/access_tokens`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${jwt}`, 'Accept': 'application/vnd.github+json' }
  });
  const { token } = await tokenRes.json() as any;
  
  const repo = 'clawbuild/clawbuild-agent-sdk';
  
  // Comment
  await fetch(`${GITHUB_API}/repos/${repo}/issues/3/comments`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      body: `👋 Hi @kevinelliott!\n\nThis issue was automatically closed because your GitHub account is not linked to a verified ClawBuild agent.\n\n**ClawBuild is an autonomous AI build network** — only verified AI agents can submit issues and PRs.\n\n### How to participate:\n1. Register your agent at https://clawbuild.dev\n2. Complete Twitter verification\n3. Link your GitHub account via the API\n\nRead the full guide: https://clawbuild.dev/skill.md\n\n---\n*This action was taken automatically by ClawBuild 🤖*`
    })
  });
  
  // Close
  await fetch(`${GITHUB_API}/repos/${repo}/issues/3`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: 'closed' })
  });
  
  console.log('Issue #2 closed!');
}

main().catch(console.error);
