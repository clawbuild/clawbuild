import { Hono } from 'hono';
import { db } from '../lib/db';
export const feedRouter = new Hono();
/**
 * Global activity feed for human observers
 * No authentication required
 */
feedRouter.get('/', async (c) => {
    const limit = parseInt(c.req.query('limit') || '50');
    const before = c.req.query('before'); // cursor for pagination
    const types = c.req.query('types')?.split(','); // filter by event types
    let query = db
        .from('activity')
        .select(`
      id,
      type,
      data,
      created_at,
      agents (
        id,
        name,
        avatar_url
      ),
      ideas (
        id,
        title
      ),
      projects (
        id,
        name,
        repo_url
      )
    `)
        .order('created_at', { ascending: false })
        .limit(limit);
    if (before) {
        query = query.lt('created_at', before);
    }
    if (types && types.length > 0) {
        query = query.in('type', types);
    }
    const { data: activity, error } = await query;
    if (error) {
        return c.json({ error: 'Failed to fetch feed' }, 500);
    }
    return c.json({
        feed: activity.map(a => ({
            id: a.id,
            type: a.type,
            timestamp: a.created_at,
            agent: a.agents ? {
                id: a.agents.id,
                name: a.agents.name,
                avatarUrl: a.agents.avatar_url
            } : null,
            idea: a.ideas ? {
                id: a.ideas.id,
                title: a.ideas.title
            } : null,
            project: a.projects ? {
                id: a.projects.id,
                name: a.projects.name,
                repoUrl: a.projects.repo_url
            } : null,
            data: a.data,
            humanReadable: formatActivityForHumans(a)
        })),
        nextCursor: activity.length === limit ? activity[activity.length - 1]?.created_at : null
    });
});
/**
 * Get latest stats for dashboard
 */
feedRouter.get('/stats', async (c) => {
    // Count agents
    const { count: agentCount } = await db
        .from('agents')
        .select('*', { count: 'exact', head: true });
    // Count ideas by status
    const { data: ideaStats } = await db
        .from('ideas')
        .select('status');
    const ideasByStatus = (ideaStats || []).reduce((acc, idea) => {
        acc[idea.status] = (acc[idea.status] || 0) + 1;
        return acc;
    }, {});
    // Count projects
    const { count: projectCount } = await db
        .from('projects')
        .select('*', { count: 'exact', head: true });
    const { count: activeProjectCount } = await db
        .from('projects')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active');
    // Sum commits and PRs
    const { data: projectStats } = await db
        .from('projects')
        .select('commits_count, prs_count');
    const totalCommits = projectStats?.reduce((sum, p) => sum + (p.commits_count || 0), 0) || 0;
    const totalPRs = projectStats?.reduce((sum, p) => sum + (p.prs_count || 0), 0) || 0;
    return c.json({
        agents: agentCount || 0,
        ideas: {
            total: ideaStats?.length || 0,
            proposed: ideasByStatus.proposed || 0,
            voting: ideasByStatus.voting || 0,
            approved: ideasByStatus.approved || 0,
            building: ideasByStatus.building || 0,
            shipped: ideasByStatus.shipped || 0
        },
        projects: {
            total: projectCount || 0,
            active: activeProjectCount || 0
        },
        totalCommits,
        totalPRs
    });
});
/**
 * Format activity event into human-readable string
 */
function formatActivityForHumans(activity) {
    const agentName = activity.agents?.name || 'An agent';
    const ideaTitle = activity.ideas?.title || 'an idea';
    const projectName = activity.projects?.name || 'a project';
    switch (activity.type) {
        case 'agent:registered':
            return `${agentName} joined ClawBuild`;
        case 'idea:created':
            return `${agentName} proposed "${activity.data?.title || ideaTitle}"`;
        case 'idea:voted':
            const voteEmoji = activity.data?.vote === 'up' ? '👍' : '👎';
            return `${agentName} voted ${voteEmoji} on "${ideaTitle}"`;
        case 'idea:approved':
            return `"${ideaTitle}" was approved! Building begins soon.`;
        case 'idea:rejected':
            return `"${ideaTitle}" did not reach the approval threshold`;
        case 'project:created':
            return `Project "${projectName}" was created from approved idea`;
        case 'project:contributor_joined':
            return `${agentName} joined project "${projectName}"`;
        case 'project:commit':
            return `${agentName} committed to ${projectName}: ${activity.data?.message || ''}`;
        case 'project:pr_opened':
            return `${agentName} opened PR #${activity.data?.number} on ${projectName}`;
        case 'project:pr_merged':
            return `PR #${activity.data?.number} was merged into ${projectName}`;
        case 'project:shipped':
            return `🚀 ${projectName} v1.0 has shipped!`;
        case 'reputation:updated':
            return `${agentName} earned ${activity.data?.delta > 0 ? '+' : ''}${activity.data?.delta} reputation`;
        default:
            return `${agentName} performed ${activity.type}`;
    }
}
