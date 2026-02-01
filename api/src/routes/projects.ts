// @ts-nocheck
import { Hono } from 'hono'
import { db } from '../lib/db'
import { verifyAgent, AgentContext } from '../middleware/auth'

export const projectsRouter = new Hono()

// List projects
projectsRouter.get('/', async (c) => {
  const status = c.req.query('status') // setup, active, shipped, archived
  const limit = parseInt(c.req.query('limit') || '20')
  const offset = parseInt(c.req.query('offset') || '0')

  let query = db
    .from('projects')
    .select(`
      id,
      name,
      repo_url,
      repo_full_name,
      status,
      commits_count,
      prs_count,
      issues_count,
      created_at,
      shipped_at,
      agents!projects_lead_agent_id_fkey (
        id,
        name
      ),
      ideas (
        id,
        title
      )
    `)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) {
    query = query.eq('status', status)
  }

  const { data: projects, error } = await query

  if (error) {
    return c.json({ error: 'Failed to list projects' }, 500)
  }

  return c.json({
    projects: projects.map(p => ({
      id: p.id,
      name: p.name,
      repoUrl: p.repo_url,
      repoFullName: p.repo_full_name,
      status: p.status,
      leadAgent: {
        id: p.agents?.id,
        name: p.agents?.name
      },
      idea: {
        id: p.ideas?.id,
        title: p.ideas?.title
      },
      stats: {
        commits: p.commits_count,
        prs: p.prs_count,
        issues: p.issues_count
      },
      createdAt: p.created_at,
      shippedAt: p.shipped_at
    })),
    count: projects.length,
    offset,
    limit
  })
})

// Get project by ID
projectsRouter.get('/:id', async (c) => {
  const id = c.req.param('id')

  const { data: project, error } = await db
    .from('projects')
    .select(`
      *,
      agents!projects_lead_agent_id_fkey (
        id,
        name,
        avatar_url
      ),
      ideas (
        id,
        title,
        description
      ),
      project_contributors (
        agent_id,
        role,
        commits,
        prs_opened,
        prs_merged,
        reviews_given,
        joined_at,
        agents (
          id,
          name
        )
      )
    `)
    .eq('id', id)
    .single()

  if (error || !project) {
    return c.json({ error: 'Project not found' }, 404)
  }

  return c.json({
    id: project.id,
    name: project.name,
    repoUrl: project.repo_url,
    repoFullName: project.repo_full_name,
    status: project.status,
    leadAgent: {
      id: project.agents?.id,
      name: project.agents?.name,
      avatarUrl: project.agents?.avatar_url
    },
    idea: {
      id: project.ideas?.id,
      title: project.ideas?.title,
      description: project.ideas?.description
    },
    contributors: project.project_contributors?.map(pc => ({
      agentId: pc.agents?.id,
      agentName: pc.agents?.name,
      role: pc.role,
      commits: pc.commits,
      prsOpened: pc.prs_opened,
      prsMerged: pc.prs_merged,
      reviewsGiven: pc.reviews_given,
      joinedAt: pc.joined_at
    })) || [],
    stats: {
      commits: project.commits_count,
      prs: project.prs_count,
      issues: project.issues_count
    },
    createdAt: project.created_at,
    shippedAt: project.shipped_at
  })
})

// Join a project as contributor (requires auth)
projectsRouter.post('/:id/join', verifyAgent, async (c) => {
  const agent = c.get('agent') as AgentContext
  const projectId = c.req.param('id')

  // Check project exists and is active
  const { data: project } = await db
    .from('projects')
    .select('id, status, name')
    .eq('id', projectId)
    .single()

  if (!project) {
    return c.json({ error: 'Project not found' }, 404)
  }

  if (project.status !== 'active' && project.status !== 'setup') {
    return c.json({ error: 'Project is not accepting contributors' }, 400)
  }

  // Check if already a contributor
  const { data: existing } = await db
    .from('project_contributors')
    .select('id')
    .eq('project_id', projectId)
    .eq('agent_id', agent.agentId)
    .single()

  if (existing) {
    return c.json({ error: 'Already a contributor' }, 409)
  }

  // Add as contributor
  const { error } = await db
    .from('project_contributors')
    .insert({
      project_id: projectId,
      agent_id: agent.agentId,
      role: 'contributor'
    })

  if (error) {
    return c.json({ error: 'Failed to join project' }, 500)
  }

  // Log activity
  await db.from('activity').insert({
    type: 'project:contributor_joined',
    agent_id: agent.agentId,
    project_id: projectId,
    data: { projectName: project.name }
  })

  return c.json({ success: true })
})

// Get project activity
projectsRouter.get('/:id/activity', async (c) => {
  const projectId = c.req.param('id')
  const limit = parseInt(c.req.query('limit') || '50')

  const { data: activity, error } = await db
    .from('activity')
    .select(`
      id,
      type,
      data,
      created_at,
      agents (
        id,
        name
      )
    `)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    return c.json({ error: 'Failed to get activity' }, 500)
  }

  return c.json({
    activity: activity.map(a => ({
      id: a.id,
      type: a.type,
      data: a.data,
      agentId: a.agents?.id,
      agentName: a.agents?.name,
      createdAt: a.created_at
    }))
  })
})
