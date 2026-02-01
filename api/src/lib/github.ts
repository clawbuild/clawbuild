import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';

let octokitInstance: Octokit | null = null;

function getPrivateKey(): string {
  // Try base64-encoded key first (for Vercel/edge runtime)
  if (process.env.GITHUB_APP_PRIVATE_KEY_BASE64) {
    return atob(process.env.GITHUB_APP_PRIVATE_KEY_BASE64);
  }
  
  // Try direct key value
  if (process.env.GITHUB_APP_PRIVATE_KEY) {
    return process.env.GITHUB_APP_PRIVATE_KEY;
  }
  
  throw new Error('No GitHub App private key configured');
}

async function getOctokit(): Promise<Octokit> {
  if (octokitInstance) return octokitInstance;
  
  const appId = process.env.GITHUB_APP_ID;
  if (!appId) throw new Error('GITHUB_APP_ID not configured');
  
  const privateKey = getPrivateKey();
  const org = process.env.GITHUB_ORG || 'clawbuild';
  
  // Create app-authenticated Octokit
  const appOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: parseInt(appId),
      privateKey,
    },
  });
  
  // Get installation ID for the org
  const { data: installations } = await appOctokit.apps.listInstallations();
  const installation = installations.find(
    (i) => i.account?.login?.toLowerCase() === org.toLowerCase()
  );
  
  if (!installation) {
    throw new Error(`GitHub App not installed on org: ${org}`);
  }
  
  // Create installation-authenticated Octokit
  octokitInstance = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: parseInt(appId),
      privateKey,
      installationId: installation.id,
    },
  });
  
  return octokitInstance;
}

export interface CreateRepoOptions {
  name: string;
  description?: string;
  isPrivate?: boolean;
  hasIssues?: boolean;
  hasProjects?: boolean;
  hasWiki?: boolean;
}

export async function createRepo(options: CreateRepoOptions): Promise<{
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  clone_url: string;
  ssh_url: string;
}> {
  const octokit = await getOctokit();
  const org = process.env.GITHUB_ORG || 'clawbuild';
  
  const { data: repo } = await octokit.repos.createInOrg({
    org,
    name: options.name,
    description: options.description,
    private: options.isPrivate ?? false,
    has_issues: options.hasIssues ?? true,
    has_projects: options.hasProjects ?? true,
    has_wiki: options.hasWiki ?? false,
    auto_init: true, // Initialize with README
  });
  
  return {
    id: repo.id,
    name: repo.name,
    full_name: repo.full_name,
    html_url: repo.html_url,
    clone_url: repo.clone_url,
    ssh_url: repo.ssh_url,
  };
}

export async function addCollaborator(
  repo: string,
  username: string,
  permission: 'pull' | 'push' | 'admin' = 'push'
): Promise<void> {
  const octokit = await getOctokit();
  const org = process.env.GITHUB_ORG || 'clawbuild';
  
  await octokit.repos.addCollaborator({
    owner: org,
    repo,
    username,
    permission,
  });
}

export async function createWebhook(
  repo: string,
  webhookUrl: string,
  events: string[] = ['push', 'pull_request', 'issues']
): Promise<number> {
  const octokit = await getOctokit();
  const org = process.env.GITHUB_ORG || 'clawbuild';
  
  const { data: hook } = await octokit.repos.createWebhook({
    owner: org,
    repo,
    config: {
      url: webhookUrl,
      content_type: 'json',
    },
    events,
    active: true,
  });
  
  return hook.id;
}

export async function getInstallationInfo(): Promise<{
  installed: boolean;
  org: string;
  installationId?: number;
}> {
  try {
    const appId = process.env.GITHUB_APP_ID;
    if (!appId) return { installed: false, org: process.env.GITHUB_ORG || 'clawbuild' };
    
    const privateKey = getPrivateKey();
    const org = process.env.GITHUB_ORG || 'clawbuild';
    
    const appOctokit = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: parseInt(appId),
        privateKey,
      },
    });
    
    const { data: installations } = await appOctokit.apps.listInstallations();
    const installation = installations.find(
      (i) => i.account?.login?.toLowerCase() === org.toLowerCase()
    );
    
    return {
      installed: !!installation,
      org,
      installationId: installation?.id,
    };
  } catch (error) {
    return { installed: false, org: process.env.GITHUB_ORG || 'clawbuild' };
  }
}
