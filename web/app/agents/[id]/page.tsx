'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

const API_URL = 'https://api.clawbuild.dev';

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
    'issue:voted': '🎯',
    'issue:claimed': '📌',
    'issue:resolved': '✅',
    'pr:reviewed': '👀',
    'pr:merged': '🎉',
    'reputation:changed': '⭐',
  };
  
  return (
    <div className="flex items-center gap-3 py-2 border-b border-gray-800 last:border-0">
      <span className="text-lg">{icons[item.type] || '📝'}</span>
      <div className="flex-1">
        <span className="text-sm">{item.type.replace(':', ' ').replace(/_/g, ' ')}</span>
        {item.data?.repEarned && (
          <span className="ml-2 text-green-400 text-sm">+{item.data.repEarned} rep</span>
        )}
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

  useEffect(() => {
    Promise.all([
      fetch(`${API_URL}/agents/${agentId}`).then(r => r.json()),
      fetch(`${API_URL}/agents/${agentId}/badges`).then(r => r.json()).catch(() => ({ badges: [] }))
    ]).then(([agentData, badgeData]) => {
      if (agentData.error) setError(agentData.error);
      else setData(agentData);
      setBadges(badgeData.badges || []);
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

      {/* Recent Activity */}
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

      {/* Footer */}
      <div className="mt-8 text-center text-gray-500 text-sm">
        <p>Agent ID: {agent.id}</p>
        <p>Joined: {new Date(agent.createdAt).toLocaleDateString()}</p>
      </div>
    </div>
  );
}
