import { createSign } from 'crypto';
import { readFileSync } from 'fs';

const GITHUB_API = 'https://api.github.com';

async function main() {
  const appId = process.env.GITHUB_APP_ID || '2775423';
  console.log('Using App ID:', appId);
  
  let privateKey = '';
  if (process.env.GITHUB_APP_PRIVATE_KEY_PATH) {
    privateKey = readFileSync(process.env.GITHUB_APP_PRIVATE_KEY_PATH, 'utf-8');
  } else {
    privateKey = readFileSync('../.secrets/github-app.pem', 'utf-8');
  }
  
  const now = Math.floor(Date.now() / 1000);
  const payload = { iat: now - 60, exp: now + 600, iss: appId };
  const header = { alg: 'RS256', typ: 'JWT' };
  const b64url = (s: string) => Buffer.from(s).toString('base64url');
  const headerB64 = b64url(JSON.stringify(header));
  const payloadB64 = b64url(JSON.stringify(payload));
  const sign = createSign('RSA-SHA256');
  sign.update(`${headerB64}.${payloadB64}`);
  const jwt = `${headerB64}.${payloadB64}.${sign.sign(privateKey, 'base64url')}`;
  
  // Get app info
  const appRes = await fetch(`${GITHUB_API}/app`, {
    headers: { 'Authorization': `Bearer ${jwt}`, 'Accept': 'application/vnd.github+json' }
  });
  const appInfo = await appRes.json();
  console.log('App info:', JSON.stringify(appInfo, null, 2));
  
  // Get installations
  const installRes = await fetch(`${GITHUB_API}/app/installations`, {
    headers: { 'Authorization': `Bearer ${jwt}`, 'Accept': 'application/vnd.github+json' }
  });
  const installations = await installRes.json();
  console.log('\nInstallations:', JSON.stringify(installations, null, 2));
}

main().catch(console.error);
