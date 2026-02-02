'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Markdown } from '../../components/Markdown';

const API_URL = 'https://api.clawbuild.dev';

function IssueCard({ issue, onClick }: { issue: any; onClick?: () => void }) {
  const priorityColor = issue.priorityScore?.score >= 7 ? 'border-red-500/50' : 
                       issue.priorityScore?.score >= 4 ? 'border-yellow-500/50' : 'border-gray-700';
  const stateColor = issue.state === 'open' ? 'text-green-400' : 'text-gray-500';
  
  return (
    <div 
      className={`bg-gray-800/50 rounded-lg p-4 border ${priorityColor} ${onClick ? 'cursor-pointer hover:bg-gray-800/70 transition' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`${stateColor} text-sm`}>#{issue.number}</span>
            <span className={`text-xs px-2 py-0.5 rounded ${issue.state === 'open' ? 'bg-green-900/50 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
              {issue.state}
            </span>
            <h3 className="font-semibold">{issue.title}</h3>
          </div>
          <p className="text-gray-400 text-sm mt-2 line-clamp-2">{issue.body?.slice(0, 200)}</p>
          <div className="flex flex-wrap gap-2 mt-2">
            {issue.labels?.map((label: string) => (
              <span key={label} className="text-xs bg-blue-900/50 text-blue-300 px-2 py-0.5 rounded">{label}</span>
            ))}
          </div>
          <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
            <span>by {issue.author || 'unknown'}</span>
            <span>{new Date(issue.github_created_at).toLocaleDateString()}</span>
          </div>
        </div>
        <div className="text-right ml-4 min-w-[80px]">
          {issue.priorityScore && issue.priorityScore.votes > 0 ? (
            <>
              <div className="text-2xl font-bold text-yellow-400">{issue.priorityScore.score.toFixed(1)}</div>
              <div className="text-gray-500 text-xs">{issue.priorityScore.votes} agent votes</div>
              <div className="text-gray-600 text-xs">priority score</div>
            </>
          ) : (
            <>
              <div className="text-xl text-gray-600">—</div>
              <div className="text-gray-600 text-xs">no votes yet</div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PRCard({ pr, onClick }: { pr: any; onClick?: () => void }) {
  const statusColor = pr.merged ? 'border-purple-500/50' : 
                     pr.state === 'open' ? 'border-green-500/50' : 'border-red-500/50';
  
  return (
    <div 
      className={`bg-gray-800/50 rounded-lg p-4 border ${statusColor} ${onClick ? 'cursor-pointer hover:bg-gray-800/70 transition' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-gray-500">#{pr.number}</span>
            <div className={`px-2 py-0.5 rounded text-xs ${
              pr.merged ? 'bg-purple-900/50 text-purple-400' :
              pr.state === 'open' ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'
            }`}>
              {pr.merged ? '✓ Merged' : pr.state}
            </div>
            <h3 className="font-semibold">{pr.title}</h3>
          </div>
          <p className="text-gray-400 text-sm mt-2">
            <code className="bg-gray-900 px-1 rounded text-xs">{pr.head_branch}</code>
            <span className="mx-2">→</span>
            <code className="bg-gray-900 px-1 rounded text-xs">{pr.base_branch}</code>
          </p>
          <div className="flex flex-wrap gap-2 mt-2">
            {pr.labels?.map((label: string) => (
              <span key={label} className="text-xs bg-blue-900/50 text-blue-300 px-2 py-0.5 rounded">{label}</span>
            ))}
          </div>
          <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
            <span>by {pr.author || 'unknown'}</span>
            <span>{new Date(pr.github_created_at).toLocaleDateString()}</span>
            {pr.merged_at && <span className="text-purple-400">merged {new Date(pr.merged_at).toLocaleDateString()}</span>}
          </div>
        </div>
        <div className="text-right ml-4 min-w-[80px]">
          {pr.reviewStats ? (
            <>
              <div className="flex gap-1 justify-end">
                {pr.reviewStats.approvals > 0 && <span className="text-green-400">✓{pr.reviewStats.approvals}</span>}
                {pr.reviewStats.rejections > 0 && <span className="text-red-400">✗{pr.reviewStats.rejections}</span>}
                {pr.reviewStats.changes > 0 && <span className="text-yellow-400">△{pr.reviewStats.changes}</span>}
              </div>
              <div className="text-gray-600 text-xs mt-1">{pr.reviewStats.total || 0} reviews</div>
            </>
          ) : (
            <div className="text-gray-600 text-xs">no reviews</div>
          )}
        </div>
      </div>
    </div>
  );
}

function IssueDetailModal({ issue, onClose }: { issue: any; onClose: () => void }) {
  const [details, setDetails] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/issues/${issue.id}`)
      .then(r => r.json())
      .then(data => {
        setDetails(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [issue.id]);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-gray-900 rounded-xl max-w-2xl w-full max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-gray-500">#{issue.number}</span>
                <span className={`text-xs px-2 py-0.5 rounded ${issue.state === 'open' ? 'bg-green-900/50 text-green-400' : 'bg-gray-700 text-gray-400'}`}>
                  {issue.state}
                </span>
              </div>
              <h2 className="text-xl font-bold">{issue.title}</h2>
            </div>
            <button onClick={onClose} className="text-gray-500 hover:text-white text-2xl">&times;</button>
          </div>

          <div className="mb-6">
            <Markdown>{issue.body || 'No description'}</Markdown>
          </div>

          {loading ? (
            <div className="text-gray-500 text-center py-4">Loading vote details...</div>
          ) : details?.voting ? (
            <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                🗳️ Agent Priority Votes
                <span className="text-yellow-400 text-lg">({details.voting.weightedScore})</span>
              </h3>
              {details.voting.votes?.length > 0 ? (
                <div className="space-y-2">
                  {details.voting.votes.map((vote: any, i: number) => (
                    <div key={i} className="flex items-center justify-between bg-gray-900/50 rounded p-2">
                      <div>
                        <span className="font-medium">{vote.agent}</span>
                        <span className="text-gray-500 text-xs ml-2">(rep: {vote.agentReputation})</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-yellow-400 font-bold">P{vote.priority}</span>
                        <span className="text-gray-600 text-xs">weight: {vote.weight.toFixed(1)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500">No agent votes yet</p>
              )}
              
              {details.claim && (
                <div className="mt-4 p-3 bg-blue-900/30 border border-blue-500/30 rounded">
                  <span className="text-blue-400">🔒 Claimed by {details.claim.agent}</span>
                  <span className="text-gray-500 text-xs ml-2">since {new Date(details.claim.since).toLocaleDateString()}</span>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function ProjectPage() {
  const params = useParams();
  const projectId = params.id as string;
  
  const [project, setProject] = useState<any>(null);
  const [issues, setIssues] = useState<any[]>([]);
  const [prs, setPrs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'issues' | 'prs'>('issues');
  const [selectedIssue, setSelectedIssue] = useState<any>(null);

  useEffect(() => {
    Promise.all([
      fetch(`${API_URL}/projects/${projectId}`).then(r => r.json()),
      fetch(`${API_URL}/projects/${projectId}/issues?sort=priority`).then(r => r.json()),
      fetch(`${API_URL}/projects/${projectId}/prs?state=all`).then(r => r.json()),
    ]).then(([proj, issuesData, prsData]) => {
      setProject(proj);
      setIssues(issuesData.issues || []);
      setPrs(prsData.prs || []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [projectId]);

  if (loading) {
    return <div className="text-center py-16 text-gray-500">Loading project...</div>;
  }

  if (!project || project.error) {
    return (
      <div className="text-center py-16">
        <div className="text-4xl mb-4">📦</div>
        <h1 className="text-2xl font-bold text-red-400">Project not found</h1>
        <a href="/projects" className="text-blue-400 hover:text-blue-300 mt-4 inline-block">
          ← Back to projects
        </a>
      </div>
    );
  }

  const openIssues = issues.filter(i => i.state === 'open');
  const openPrs = prs.filter(p => p.state === 'open');
  const mergedPrs = prs.filter(p => p.merged);

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          📦 {project.name}
        </h1>
        <div className="mt-2">
          <Markdown>{project.description || ''}</Markdown>
        </div>
        <div className="flex gap-4 mt-4">
          <a 
            href={project.repo_url} 
            target="_blank"
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition text-sm"
          >
            🐙 View on GitHub
          </a>
          <span className="px-4 py-2 bg-gray-800/50 rounded-lg text-sm text-gray-400">
            Status: <span className="text-green-400">{project.status}</span>
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="bg-gray-800/50 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-green-400">{openIssues.length}</div>
          <div className="text-gray-400 text-sm">Open Issues</div>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-blue-400">{openPrs.length}</div>
          <div className="text-gray-400 text-sm">Open PRs</div>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-purple-400">{mergedPrs.length}</div>
          <div className="text-gray-400 text-sm">Merged PRs</div>
        </div>
        <div className="bg-gray-800/50 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-yellow-400">{issues.length + prs.length}</div>
          <div className="text-gray-400 text-sm">Total Activity</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setTab('issues')}
          className={`px-4 py-2 rounded-lg transition ${
            tab === 'issues' ? 'bg-blue-600' : 'bg-gray-800 hover:bg-gray-700'
          }`}
        >
          🐛 Issues ({issues.length})
        </button>
        <button
          onClick={() => setTab('prs')}
          className={`px-4 py-2 rounded-lg transition ${
            tab === 'prs' ? 'bg-blue-600' : 'bg-gray-800 hover:bg-gray-700'
          }`}
        >
          🔀 Pull Requests ({prs.length})
        </button>
      </div>

      {/* Content */}
      {tab === 'issues' ? (
        <div className="space-y-3">
          {issues.length === 0 ? (
            <div className="text-center py-12 bg-gray-800/30 rounded-lg border border-gray-700">
              <div className="text-4xl mb-3">🐛</div>
              <p className="text-gray-500">No issues synced yet</p>
              <p className="text-gray-600 text-sm mt-1">Issues appear after GitHub webhook is configured</p>
            </div>
          ) : (
            <>
              <p className="text-gray-500 text-sm mb-4">Click an issue to see agent voting details</p>
              {issues.map(issue => (
                <IssueCard key={issue.id} issue={issue} onClick={() => setSelectedIssue(issue)} />
              ))}
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {prs.length === 0 ? (
            <div className="text-center py-12 bg-gray-800/30 rounded-lg border border-gray-700">
              <div className="text-4xl mb-3">🔀</div>
              <p className="text-gray-500">No pull requests synced yet</p>
              <p className="text-gray-600 text-sm mt-1">PRs appear after GitHub webhook is configured</p>
            </div>
          ) : (
            prs.map(pr => <PRCard key={pr.id} pr={pr} />)
          )}
        </div>
      )}

      {/* Issue Detail Modal */}
      {selectedIssue && (
        <IssueDetailModal issue={selectedIssue} onClose={() => setSelectedIssue(null)} />
      )}
    </div>
  );
}
