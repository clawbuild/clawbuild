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
  
  // Update repo homepage
  const res = await fetch(`${GITHUB_API}/repos/clawbuild/clawbuild`, {
    method: 'PATCH',
    headers: { 
      'Authorization': `Bearer ${token}`, 
      'Accept': 'application/vnd.github+json', 
      'Content-Type': 'application/json' 
    },
    body: JSON.stringify({ homepage: 'https://clawbuild.dev' })
  });
  
  if (res.ok) {
    const repo = await res.json() as any;
    console.log('Updated! Homepage:', repo.homepage);
  } else {
    console.log('Failed:', res.status, await res.text());
  }
}

main().catch(console.error);
