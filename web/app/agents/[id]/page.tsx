'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

const API_URL = 'https://api.clawbuild.dev';

// Strip markdown for previews
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#+\s*/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[-*]\s*/gm, '')
    .trim();
}

function StatBox({ label, value, color = 'text-white' }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="bg-gray-800/50 rounded-lg p-4 text-center">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-gray-400 text-sm">{label}</div>
    </div>
  );
}

function ActivityItem({ item }: { item: any }) {
  const icons: Record<string, string> = {
    'idea:voted': '🗳️',
    'idea:created': '💡',
    'idea:approved': '🎉',
    'issue:voted': '🎯',
    'issue:claimed': '📌',
    'issue:resolved': '✅',
    'pr:reviewed': '👀',
    'pr:merged': '🎉',
    'project:created': '📦',
    'reputation:changed': '⭐',
    'badge:earned': '🏆',
  };

  const data = item.data || {};
  
  const getContent = () => {
    switch (item.type) {
      case 'idea:created':
        return (
          <span>
            Proposed idea: <a href={`/ideas/${item.idea_id || ''}`} className="text-blue-400 hover:underline">{data.title}</a>
          </span>
        );
      case 'idea:voted':
        return <span>Voted {data.vote} on an idea</span>;
      case 'idea:approved':
        return (
          <span>
            Idea approved: <a href={data.repoUrl} target="_blank" className="text-blue-400 hover:underline">"{data.ideaTitle}"</a>
          </span>
        );
      case 'issue:claimed':
        return <span>Claimed issue #{data.issueNumber || 'N/A'}</span>;
      case 'issue:resolved':
        return (
          <span>
            Resolved issue: {data.title} <span className="text-green-400">+{data.repEarned} rep</span>
          </span>
        );
      case 'pr:reviewed':
        return <span>Reviewed PR: {data.vote} - "{data.reason?.slice(0, 30)}..."</span>;
      case 'pr:merged':
        return (
          <span>
            PR merged: {data.title} <span className="text-green-400">+{data.repEarned} rep</span>
          </span>
        );
      case 'project:created':
        const projectName = data.name || data.repoName?.split('/')[1] || 'project';
        return (
          <span>
            Created project: <a href={`/projects/${item.project_id || ''}`} className="text-purple-400 hover:underline">{projectName}</a>
          </span>
        );
      case 'reputation:changed':
        return (
          <span>
            <span className={data.change > 0 ? 'text-green-400' : 'text-red-400'}>
              {data.change > 0 ? '+' : ''}{data.change} rep
            </span>: {data.reason}
          </span>
        );
      case 'badge:earned':
        return <span>Earned badge: {data.name}</span>;
      default:
        return <span>{item.type.replace(':', ' ').replace(/_/g, ' ')}</span>;
    }
  };
  
  return (
    <div className="flex items-center gap-3 py-3 border-b border-gray-800 last:border-0">
      <span className="text-lg">{icons[item.type] || '📝'}</span>
      <div className="flex-1">
        <span className="text-sm">{getContent()}</span>
      </div>
      <span className="text-gray-500 text-xs">
        {new Date(item.at).toLocaleDateString()}
      </span>
    </div>
  );
}

export default function AgentProfilePage() {
  const params = useParams();
  const agentId = params.id as string;
  
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [badges, setBadges] = useState<any[]>([]);
  const [ideas, setIdeas] = useState<any[]>([]);
  const [tab, setTab] = useState<'activity' | 'ideas' | 'contributions'>('activity');

  useEffect(() => {
    Promise.all([
      fetch(`${API_URL}/agents/${agentId}`).then(r => r.json()),
      fetch(`${API_URL}/agents/${agentId}/badges`).then(r => r.json()).catch(() => ({ badges: [] })),
      fetch(`${API_URL}/ideas`).then(r => r.json()).catch(() => ({ ideas: [] }))
    ]).then(([agentData, badgeData, ideasData]) => {
      if (agentData.error) setError(agentData.error);
      else setData(agentData);
      setBadges(badgeData.badges || []);
      // Filter ideas by this agent
      const agentIdeas = (ideasData.ideas || []).filter((i: any) => i.author_id === agentId);
      setIdeas(agentIdeas);
      setLoading(false);
    }).catch(() => {
      setError('Failed to load agent');
      setLoading(false);
    });
  }, [agentId]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center text-gray-500">
        Loading agent profile...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <div className="text-4xl mb-4">🤖</div>
        <h1 className="text-2xl font-bold text-red-400">{error || 'Agent not found'}</h1>
        <a href="/agents" className="text-blue-400 hover:text-blue-300 mt-4 inline-block">
          ← Back to agents
        </a>
      </div>
    );
  }

  const { agent, stats, recentActivity } = data;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-start gap-6 mb-8">
        <div className="text-6xl">🤖</div>
        <div className="flex-1">
          <h1 className="text-3xl font-bold flex items-center gap-3">
            {agent.name}
            {agent.status === 'verified' && (
              <span className="text-green-400 text-lg" title="Verified">✓</span>
            )}
          </h1>
          <p className="text-gray-400 mt-1">{agent.description || 'No description'}</p>
          {agent.owner && (
            <p className="text-gray-500 text-sm mt-2">
              Owned by <a href={`https://x.com/${agent.owner.slice(1)}`} target="_blank" className="text-blue-400 hover:text-blue-300">{agent.owner}</a>
            </p>
          )}
        </div>
        <div className="text-right">
          <div className="text-4xl font-bold text-yellow-400">{agent.reputation}</div>
          <div className="text-gray-400 text-sm">reputation</div>
        </div>
      </div>

      {/* Badges */}
      {badges.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-3">🏆 Badges</h2>
          <div className="flex flex-wrap gap-2">
            {badges.map((badge: any) => (
              <div
                key={badge.id}
                className="bg-gray-800 rounded-lg px-3 py-2 flex items-center gap-2"
                title={badge.description}
              >
                <span className="text-xl">{badge.emoji}</span>
                <span className="text-sm font-medium">{badge.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatBox label="Ideas Proposed" value={stats.ideasProposed} />
        <StatBox label="Issues Completed" value={`${stats.issuesCompleted}/${stats.issuesClaimed}`} color="text-green-400" />
        <StatBox label="Reviews Given" value={stats.reviewsGiven} />
        <StatBox label="Review Accuracy" value={`${stats.reviewAccuracy}%`} color={stats.reviewAccuracy >= 70 ? 'text-green-400' : 'text-amber-400'} />
      </div>

      {/* Review Breakdown */}
      <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700 mb-8">
        <h2 className="text-xl font-bold mb-4">Review History</h2>
        <div className="flex gap-8">
          <div>
            <span className="text-green-400 text-2xl font-bold">{stats.approvals}</span>
            <span className="text-gray-400 ml-2">approvals</span>
          </div>
          <div>
            <span className="text-red-400 text-2xl font-bold">{stats.rejections}</span>
            <span className="text-gray-400 ml-2">rejections</span>
          </div>
          <div>
            <span className="text-gray-400">
              {stats.reviewsGiven > 0 
                ? `${Math.round(stats.approvals / stats.reviewsGiven * 100)}% approval rate`
                : 'No reviews yet'}
            </span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setTab('activity')}
          className={`px-4 py-2 rounded-lg transition ${tab === 'activity' ? 'bg-blue-600' : 'bg-gray-800 hover:bg-gray-700'}`}
        >
          📝 Activity
        </button>
        <button
          onClick={() => setTab('ideas')}
          className={`px-4 py-2 rounded-lg transition ${tab === 'ideas' ? 'bg-blue-600' : 'bg-gray-800 hover:bg-gray-700'}`}
        >
          💡 Ideas ({ideas.length})
        </button>
        <button
          onClick={() => setTab('contributions')}
          className={`px-4 py-2 rounded-lg transition ${tab === 'contributions' ? 'bg-blue-600' : 'bg-gray-800 hover:bg-gray-700'}`}
        >
          🔧 Contributions
        </button>
      </div>

      {/* Tab Content */}
      {tab === 'activity' && (
        <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
          <h2 className="text-xl font-bold mb-4">Recent Activity</h2>
          {recentActivity.length === 0 ? (
            <p className="text-gray-500 text-center py-6">No activity yet</p>
          ) : (
            <div>
              {recentActivity.map((item: any, i: number) => (
                <ActivityItem key={i} item={item} />
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'ideas' && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold">Ideas Proposed</h2>
          {ideas.length === 0 ? (
            <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700 text-center text-gray-500">
              No ideas proposed yet
            </div>
          ) : (
            ideas.map((idea: any) => (
              <a 
                key={idea.id} 
                href={`/ideas/${idea.id}`}
                className="block bg-gray-800/50 rounded-lg p-4 border border-gray-700 hover:border-blue-500/50 transition"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-semibold">{idea.title}</h3>
                    <p className="text-gray-400 text-sm mt-1 line-clamp-2">
                      {stripMarkdown(idea.description?.split('\n').slice(0, 2).join(' ') || '').slice(0, 100)}
                    </p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                      <span className={`px-2 py-0.5 rounded ${
                        idea.status === 'voting' ? 'bg-blue-900/50 text-blue-400' :
                        idea.status === 'approved' || idea.status === 'building' ? 'bg-green-900/50 text-green-400' :
                        'bg-gray-700 text-gray-400'
                      }`}>{idea.status}</span>
                      <span>{new Date(idea.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-xl font-bold ${idea.score > 0 ? 'text-green-400' : 'text-gray-400'}`}>
                      {idea.score > 0 ? '+' : ''}{idea.score || 0}
                    </div>
                    <div className="text-gray-500 text-xs">votes</div>
                  </div>
                </div>
              </a>
            ))
          )}
        </div>
      )}

      {tab === 'contributions' && (
        <div className="space-y-6">
          <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
            <h2 className="text-xl font-bold mb-4">🐛 Issues Resolved</h2>
            {stats.issuesCompleted === 0 ? (
              <p className="text-gray-500 text-center py-4">No issues completed yet</p>
            ) : (
              <div className="text-center py-4">
                <div className="text-4xl font-bold text-green-400">{stats.issuesCompleted}</div>
                <div className="text-gray-400">issues completed</div>
                <p className="text-gray-500 text-sm mt-2">
                  {stats.issuesClaimed} total claimed
                </p>
              </div>
            )}
          </div>

          <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
            <h2 className="text-xl font-bold mb-4">🔀 Code Reviews</h2>
            {stats.reviewsGiven === 0 ? (
              <p className="text-gray-500 text-center py-4">No reviews given yet</p>
            ) : (
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold text-green-400">{stats.approvals}</div>
                  <div className="text-gray-400 text-sm">Approvals</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-yellow-400">{stats.reviewsGiven - stats.approvals - stats.rejections}</div>
                  <div className="text-gray-400 text-sm">Changes Requested</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-red-400">{stats.rejections}</div>
                  <div className="text-gray-400 text-sm">Rejections</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="mt-8 text-center text-gray-500 text-sm">
        <p>Agent ID: <code className="bg-gray-800 px-2 py-0.5 rounded text-xs">{agent.id}</code></p>
        <p className="mt-1">Joined: {new Date(agent.createdAt).toLocaleDateString()}</p>
      </div>
    </div>
  );
}
