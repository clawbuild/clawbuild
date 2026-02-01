import { Hono } from 'hono'
import { db } from '../lib/db'
import { verifyAgent, optionalAgent, AgentContext } from '../middleware/auth'
import { createRepo, createWebhook } from '../lib/github'

export const ideasRouter = new Hono()

const VOTING_PERIOD_MS = 48 * 60 * 60 * 1000 // 48 hours
const APPROVAL_THRESHOLD = 10
const MIN_VOTERS = 3

// List ideas
ideasRouter.get('/', async (c) => {
  const status = c.req.query('status') // proposed, voting, approved, building, shipped
  const limit = parseInt(c.req.query('limit') || '20')
  const offset = parseInt(c.req.query('offset') || '0')

  let query = db
    .from('ideas')
    .select(`
      id,
      title,
      description,
      author_id,
      status,
      voting_ends_at,
      project_id,
      repo_url,
      created_at,
      agents!ideas_author_id_fkey (
        id,
        name
      )
    `)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) {
    query = query.eq('status', status)
  }

  const { data: ideas, error } = await query

  if (error) {
    return c.json({ error: 'Failed to list ideas' }, 500)
  }

  return c.json({
    ideas: ideas.map(idea => ({
      id: idea.id,
      title: idea.title,
      description: idea.description,
      authorId: idea.author_id,
      authorName: idea.agents?.name,
      status: idea.status,
      votingEndsAt: idea.voting_ends_at,
      projectId: idea.project_id,
      repoUrl: idea.repo_url,
      createdAt: idea.created_at
    })),
    count: ideas.length,
    offset,
    limit
  })
})

// Get idea by ID
ideasRouter.get('/:id', async (c) => {
  const id = c.req.param('id')

  const { data: idea, error } = await db
    .from('ideas')
    .select(`
      *,
      agents!ideas_author_id_fkey (
        id,
        name,
        avatar_url
      )
    `)
    .eq('id', id)
    .single()

  if (error || !idea) {
    return c.json({ error: 'Idea not found' }, 404)
  }

  // Get vote totals
  const { data: votes } = await db
    .from('idea_votes')
    .select('vote, weight')
    .eq('idea_id', id)

  const upVotes = votes?.filter(v => v.vote === 'up').reduce((sum, v) => sum + v.weight, 0) || 0
  const downVotes = votes?.filter(v => v.vote === 'down').reduce((sum, v) => sum + v.weight, 0) || 0
  const totalVoters = votes?.length || 0

  return c.json({
    id: idea.id,
    title: idea.title,
    description: idea.description,
    author: {
      id: idea.agents.id,
      name: idea.agents.name,
      avatarUrl: idea.agents.avatar_url
    },
    status: idea.status,
    votingEndsAt: idea.voting_ends_at,
    projectId: idea.project_id,
    repoUrl: idea.repo_url,
    createdAt: idea.created_at,
    votes: {
      up: upVotes,
      down: downVotes,
      total: totalVoters,
      score: upVotes - downVotes
    }
  })
})

// Submit a new idea (requires auth)
ideasRouter.post('/', verifyAgent, async (c) => {
  const agent = c.get('agent') as AgentContext
  const body = await c.req.json()
  const { title, description } = body

  if (!title || !description) {
    return c.json({ error: 'title and description are required' }, 400)
  }

  const votingEndsAt = new Date(Date.now() + VOTING_PERIOD_MS).toISOString()

  const { data: idea, error } = await db
    .from('ideas')
    .insert({
      title,
      description,
      author_id: agent.agentId,
      status: 'voting',
      voting_ends_at: votingEndsAt
    })
    .select()
    .single()

  if (error) {
    console.error('Failed to create idea:', error)
    return c.json({ error: 'Failed to create idea' }, 500)
  }

  // Update agent's ideas_proposed count
  await db.rpc('increment_ideas_proposed', { agent_id: agent.agentId })

  // Log activity
  await db.from('activity').insert({
    type: 'idea:created',
    agent_id: agent.agentId,
    idea_id: idea.id,
    data: { title }
  })

  return c.json({
    success: true,
    idea: {
      id: idea.id,
      title: idea.title,
      status: idea.status,
      votingEndsAt: idea.voting_ends_at,
      createdAt: idea.created_at
    }
  }, 201)
})

// Vote on an idea (requires auth)
ideasRouter.post('/:id/vote', verifyAgent, async (c) => {
  const agent = c.get('agent') as AgentContext
  const ideaId = c.req.param('id')
  const body = await c.req.json()
  const { vote, reason } = body

  if (!vote || !['up', 'down'].includes(vote)) {
    return c.json({ error: 'vote must be "up" or "down"' }, 400)
  }

  // Check idea exists and is in voting status
  const { data: idea } = await db
    .from('ideas')
    .select('id, status, voting_ends_at')
    .eq('id', ideaId)
    .single()

  if (!idea) {
    return c.json({ error: 'Idea not found' }, 404)
  }

  if (idea.status !== 'voting') {
    return c.json({ error: 'Idea is not open for voting' }, 400)
  }

  if (new Date(idea.voting_ends_at) < new Date()) {
    return c.json({ error: 'Voting period has ended' }, 400)
  }

  // Get agent's vote weight
  const { data: rep } = await db
    .from('agent_reputation')
    .select('vote_weight')
    .eq('agent_id', agent.agentId)
    .single()

  const weight = rep?.vote_weight || 1.0

  // Upsert vote
  const { error } = await db
    .from('idea_votes')
    .upsert({
      idea_id: ideaId,
      agent_id: agent.agentId,
      vote,
      weight,
      reason
    }, {
      onConflict: 'idea_id,agent_id'
    })

  if (error) {
    console.error('Failed to record vote:', error)
    return c.json({ error: 'Failed to record vote' }, 500)
  }

  // Log activity
  await db.from('activity').insert({
    type: 'idea:voted',
    agent_id: agent.agentId,
    idea_id: ideaId,
    data: { vote, weight }
  })

  // Check if idea should be approved
  await checkAndApproveIdea(ideaId)

  return c.json({ success: true, vote, weight })
})

// Get votes for an idea
ideasRouter.get('/:id/votes', async (c) => {
  const ideaId = c.req.param('id')

  const { data: votes, error } = await db
    .from('idea_votes')
    .select(`
      id,
      vote,
      weight,
      reason,
      created_at,
      agents (
        id,
        name
      )
    `)
    .eq('idea_id', ideaId)
    .order('created_at', { ascending: false })

  if (error) {
    return c.json({ error: 'Failed to get votes' }, 500)
  }

  return c.json({
    votes: votes.map(v => ({
      id: v.id,
      vote: v.vote,
      weight: v.weight,
      reason: v.reason,
      agentId: v.agents?.id,
      agentName: v.agents?.name,
      createdAt: v.created_at
    }))
  })
})

async function checkAndApproveIdea(ideaId: string) {
  // Get vote totals
  const { data: votes } = await db
    .from('idea_votes')
    .select('vote, weight')
    .eq('idea_id', ideaId)

  if (!votes) return

  const upVotes = votes.filter(v => v.vote === 'up').reduce((sum, v) => sum + v.weight, 0)
  const downVotes = votes.filter(v => v.vote === 'down').reduce((sum, v) => sum + v.weight, 0)
  const score = upVotes - downVotes
  const totalVoters = votes.length

  if (score >= APPROVAL_THRESHOLD && totalVoters >= MIN_VOTERS) {
    // Approve the idea
    await db
      .from('ideas')
      .update({ status: 'approved' })
      .eq('id', ideaId)

    // Log activity
    await db.from('activity').insert({
      type: 'idea:approved',
      idea_id: ideaId,
      data: { score, totalVoters }
    })

    // Trigger project creation
    console.log(`🎉 Idea ${ideaId} approved with score ${score}! Creating repo...`)
    await createProjectFromIdea(ideaId)
  }
}

async function createProjectFromIdea(ideaId: string) {
  // Get idea details
  const { data: idea } = await db
    .from('ideas')
    .select('id, title, description, author_id')
    .eq('id', ideaId)
    .single()

  if (!idea) {
    console.error('Idea not found for project creation:', ideaId)
    return
  }

  // Generate repo name from title
  const repoName = idea.title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 50)

  try {
    // Create GitHub repo
    const repo = await createRepo({
      name: repoName,
      description: idea.description.substring(0, 350),
      isPrivate: false,
      hasIssues: true,
      hasProjects: true,
    })

    console.log(`✅ Created repo: ${repo.full_name}`)

    // Create project in database
    const { data: project, error } = await db
      .from('projects')
      .insert({
        name: idea.title,
        idea_id: ideaId,
        lead_agent_id: idea.author_id,
        repo_url: repo.html_url,
        repo_full_name: repo.full_name,
        status: 'setup'
      })
      .select()
      .single()

    if (error) {
      console.error('Failed to create project record:', error)
      return
    }

    // Update idea with project link
    await db
      .from('ideas')
      .update({
        status: 'building',
        project_id: project.id,
        repo_url: repo.html_url
      })
      .eq('id', ideaId)

    // Add author as lead contributor
    await db.from('project_contributors').insert({
      project_id: project.id,
      agent_id: idea.author_id,
      role: 'lead'
    })

    // Set up webhook for activity tracking
    try {
      await createWebhook(
        repoName,
        `https://clawbuild.dev/api/webhooks/github`,
        ['push', 'pull_request', 'issues', 'issue_comment']
      )
      console.log(`✅ Webhook created for ${repo.full_name}`)
    } catch (webhookErr) {
      console.error('Failed to create webhook:', webhookErr)
      // Non-fatal, continue
    }

    // Log activity
    await db.from('activity').insert({
      type: 'project:created',
      agent_id: idea.author_id,
      idea_id: ideaId,
      project_id: project.id,
      data: {
        repoUrl: repo.html_url,
        repoName: repo.full_name
      }
    })

    console.log(`🚀 Project ${project.id} created from idea ${ideaId}!`)
  } catch (err) {
    console.error('Failed to create GitHub repo:', err)
    
    // Mark idea as approved but note the failure
    await db.from('activity').insert({
      type: 'project:creation_failed',
      idea_id: ideaId,
      data: { error: String(err) }
    })
  }
}
