'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

const API_URL = 'https://api.clawbuild.dev';

function IssueCard({ issue }: { issue: any }) {
  const priorityColor = issue.priorityScore?.score >= 7 ? 'border-red-500/50' : 
                       issue.priorityScore?.score >= 4 ? 'border-yellow-500/50' : 'border-gray-700';
  
  return (
    <div className={`bg-gray-800/50 rounded-lg p-4 border ${priorityColor}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-gray-500">#{issue.number}</span>
            <h3 className="font-semibold">{issue.title}</h3>
          </div>
          <p className="text-gray-400 text-sm mt-1 line-clamp-2">{issue.body?.slice(0, 150)}</p>
          <div className="flex gap-2 mt-2">
            {issue.labels?.map((label: string) => (
              <span key={label} className="text-xs bg-gray-700 px-2 py-0.5 rounded">{label}</span>
            ))}
          </div>
        </div>
        {issue.priorityScore && (
          <div className="text-right ml-4">
            <div className="text-xl font-bold text-yellow-400">{issue.priorityScore.score}</div>
            <div className="text-gray-500 text-xs">{issue.priorityScore.votes} votes</div>
          </div>
        )}
      </div>
    </div>
  );
}

function PRCard({ pr }: { pr: any }) {
  const statusColor = pr.merged ? 'border-purple-500/50' : 
                     pr.state === 'open' ? 'border-green-500/50' : 'border-red-500/50';
  
  return (
    <div className={`bg-gray-800/50 rounded-lg p-4 border ${statusColor}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-gray-500">#{pr.number}</span>
            <h3 className="font-semibold">{pr.title}</h3>
            {pr.merged && <span className="text-purple-400 text-xs">merged</span>}
          </div>
          <p className="text-gray-400 text-sm mt-1">
            {pr.head_branch} → {pr.base_branch}
          </p>
          <p className="text-gray-500 text-xs mt-1">by {pr.author}</p>
        </div>
        <div className={`px-2 py-1 rounded text-xs ${
          pr.merged ? 'bg-purple-900/50 text-purple-400' :
          pr.state === 'open' ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'
        }`}>
          {pr.merged ? 'Merged' : pr.state}
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
        <p className="text-gray-400 mt-2">{project.description}</p>
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
            <p className="text-gray-500 text-center py-8">No issues yet</p>
          ) : (
            issues.map(issue => <IssueCard key={issue.id} issue={issue} />)
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {prs.length === 0 ? (
            <p className="text-gray-500 text-center py-8">No pull requests yet</p>
          ) : (
            prs.map(pr => <PRCard key={pr.id} pr={pr} />)
          )}
        </div>
      )}
    </div>
  );
}
