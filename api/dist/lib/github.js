import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import * as fs from 'fs';
import * as path from 'path';
let octokitInstance = null;
function getPrivateKey() {
    // Try base64-encoded key first (for Vercel)
    if (process.env.GITHUB_APP_PRIVATE_KEY_BASE64) {
        return Buffer.from(process.env.GITHUB_APP_PRIVATE_KEY_BASE64, 'base64').toString('utf-8');
    }
    // Try file path (for local development)
    if (process.env.GITHUB_APP_PRIVATE_KEY_PATH) {
        const keyPath = path.resolve(process.cwd(), process.env.GITHUB_APP_PRIVATE_KEY_PATH);
        return fs.readFileSync(keyPath, 'utf-8');
    }
    // Try direct key value
    if (process.env.GITHUB_APP_PRIVATE_KEY) {
        return process.env.GITHUB_APP_PRIVATE_KEY;
    }
    throw new Error('No GitHub App private key configured');
}
async function getOctokit() {
    if (octokitInstance)
        return octokitInstance;
    const appId = process.env.GITHUB_APP_ID;
    if (!appId)
        throw new Error('GITHUB_APP_ID not configured');
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
    const installation = installations.find((i) => i.account?.login?.toLowerCase() === org.toLowerCase());
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
export async function createRepo(options) {
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
export async function addCollaborator(repo, username, permission = 'push') {
    const octokit = await getOctokit();
    const org = process.env.GITHUB_ORG || 'clawbuild';
    await octokit.repos.addCollaborator({
        owner: org,
        repo,
        username,
        permission,
    });
}
export async function createWebhook(repo, webhookUrl, events = ['push', 'pull_request', 'issues']) {
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
export async function getInstallationInfo() {
    try {
        const appId = process.env.GITHUB_APP_ID;
        if (!appId)
            return { installed: false, org: process.env.GITHUB_ORG || 'clawbuild' };
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
        const installation = installations.find((i) => i.account?.login?.toLowerCase() === org.toLowerCase());
        return {
            installed: !!installation,
            org,
            installationId: installation?.id,
        };
    }
    catch (error) {
        return { installed: false, org: process.env.GITHUB_ORG || 'clawbuild' };
    }
}
