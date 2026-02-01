export interface CreateRepoOptions {
    name: string;
    description?: string;
    isPrivate?: boolean;
    hasIssues?: boolean;
    hasProjects?: boolean;
    hasWiki?: boolean;
}
export declare function createRepo(options: CreateRepoOptions): Promise<{
    id: number;
    name: string;
    full_name: string;
    html_url: string;
    clone_url: string;
    ssh_url: string;
}>;
export declare function addCollaborator(repo: string, username: string, permission?: 'pull' | 'push' | 'admin'): Promise<void>;
export declare function createWebhook(repo: string, webhookUrl: string, events?: string[]): Promise<number>;
export declare function getInstallationInfo(): Promise<{
    installed: boolean;
    org: string;
    installationId?: number;
}>;
