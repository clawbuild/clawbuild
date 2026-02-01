import { Hono } from 'hono'
import { getInstallationInfo, createRepo } from '../lib/github'
import { verifyAgent, AgentContext } from '../middleware/auth'
import { db } from '../lib/db'

export const githubRouter = new Hono()

// Check GitHub App installation status
githubRouter.get('/status', async (c) => {
  const info = await getInstallationInfo()
  
  return c.json({
    configured: !!process.env.GITHUB_APP_ID,
    installed: info.installed,
    org: info.org,
    installationId: info.installationId
  })
})

// Webhook handler for GitHub events
githubRouter.post('/webhooks/github', async (c) => {
  const event = c.req.header('X-GitHub-Event')
  const payload = await c.req.json()
  
  console.log(`📥 GitHub webhook: ${event}`)
  
  try {
    switch (event) {
      case 'push':
        await handlePush(payload)
        break
      case 'pull_request':
        await handlePullRequest(payload)
        break
      case 'issues':
        await handleIssue(payload)
        break
      case 'issue_comment':
        await handleIssueComment(payload)
        break
    }
  } catch (err) {
    console.error('Webhook handler error:', err)
  }
  
  return c.json({ received: true })
})

async function handlePush(payload: any) {
  const repoFullName = payload.repository?.full_name
  if (!repoFullName) return
  
  // Find project by repo
  const { data: project } = await db
    .from('projects')
    .select('id')
    .eq('repo_full_name', repoFullName)
    .single()
  
  if (!project) return
  
  // Increment commits count
  const commitCount = payload.commits?.length || 0
  await db.rpc('increment_project_commits', {
    p_project_id: project.id,
    p_count: commitCount
  })
  
  // Log activity
  await db.from('activity').insert({
    type: 'project:push',
    project_id: project.id,
    data: {
      commits: commitCount,
      pusher: payload.pusher?.name,
      ref: payload.ref
    }
  })
}

async function handlePullRequest(payload: any) {
  const repoFullName = payload.repository?.full_name
  const action = payload.action
  if (!repoFullName) return
  
  const { data: project } = await db
    .from('projects')
    .select('id')
    .eq('repo_full_name', repoFullName)
    .single()
  
  if (!project) return
  
  if (action === 'opened') {
    await db.rpc('increment_project_prs', { p_project_id: project.id })
  }
  
  await db.from('activity').insert({
    type: `project:pr_${action}`,
    project_id: project.id,
    data: {
      prNumber: payload.pull_request?.number,
      title: payload.pull_request?.title,
      author: payload.pull_request?.user?.login
    }
  })
}

async function handleIssue(payload: any) {
  const repoFullName = payload.repository?.full_name
  const action = payload.action
  if (!repoFullName) return
  
  const { data: project } = await db
    .from('projects')
    .select('id')
    .eq('repo_full_name', repoFullName)
    .single()
  
  if (!project) return
  
  if (action === 'opened') {
    await db.rpc('increment_project_issues', { p_project_id: project.id })
  }
  
  await db.from('activity').insert({
    type: `project:issue_${action}`,
    project_id: project.id,
    data: {
      issueNumber: payload.issue?.number,
      title: payload.issue?.title,
      author: payload.issue?.user?.login
    }
  })
}

async function handleIssueComment(payload: any) {
  const repoFullName = payload.repository?.full_name
  if (!repoFullName) return
  
  const { data: project } = await db
    .from('projects')
    .select('id')
    .eq('repo_full_name', repoFullName)
    .single()
  
  if (!project) return
  
  await db.from('activity').insert({
    type: 'project:comment',
    project_id: project.id,
    data: {
      issueNumber: payload.issue?.number,
      author: payload.comment?.user?.login,
      body: payload.comment?.body?.substring(0, 200)
    }
  })
}
