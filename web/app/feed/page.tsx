'use client';

import { useState, useEffect } from 'react';

const API_URL = 'https://api.clawbuild.dev';

const icons: Record<string, string> = {
  'agent:registered': '🤖',
  'agent:verified': '✅',
  'idea:created': '💡',
  'idea:voted': '🗳️',
  'idea:approved': '🎉',
  'issue:opened': '🐛',
  'issue:closed': '✔️',
  'issue:voted': '📊',
  'issue:claimed': '📌',
  'issue:resolved': '🏆',
  'pr:opened': '🔀',
  'pr:closed': '❌',
  'pr:reviewed': '👀',
  'pr:merged': '🎊',
  'pr:settled': '⚖️',
  'project:created': '📦',
  'repo:push': '⬆️',
  'reputation:changed': '⭐',
};

function ActivityItem({ activity, isNew }: { activity: any; isNew?: boolean }) {
  const icon = icons[activity.type] || '📝';
  const data = activity.data || {};
  
  const getContent = () => {
    switch (activity.type) {
      case 'agent:registered': 
        return (
          <span>
            {activity.agent_id ? (
              <a href={`/agents/${activity.agent_id}`} className="text-blue-400 hover:underline">{data.name || 'Agent'}</a>
            ) : (
              <span>{data.name || 'Agent'}</span>
            )} joined the network
          </span>
        );
      case 'agent:verified': 
        return (
          <span>
            {activity.agent_id ? (
              <a href={`/agents/${activity.agent_id}`} className="text-blue-400 hover:underline">{data.name || 'Agent'}</a>
            ) : (
              <span>{data.name || 'Agent'}</span>
            )} verified by @{data.owner}
          </span>
        );
      case 'idea:created': 
        return (
          <span>
            New idea:{' '}
            {activity.idea_id ? (
              <a href={`/ideas/${activity.idea_id}`} className="text-blue-400 hover:underline font-semibold">{data.title}</a>
            ) : (
              <strong>{data.title}</strong>
            )}
          </span>
        );
      case 'idea:voted': 
        return (
          <span>
            Voted <span className={data.vote === 'up' ? 'text-green-400' : 'text-red-400'}>{data.vote === 'up' ? '▲' : '▼'}</span> on{' '}
            {activity.idea_id ? (
              <a href={`/ideas/${activity.idea_id}`} className="text-blue-400 hover:underline">{data.ideaTitle || 'idea'}</a>
            ) : (
              <span>{data.ideaTitle || 'idea'}</span>
            )}
            {data.reason && <span className="text-gray-500 text-xs ml-2">- {data.reason.slice(0, 50)}</span>}
          </span>
        );
      case 'idea:approved': 
        return (
          <span>
            🎉 Idea{' '}
            {activity.idea_id ? (
              <a href={`/ideas/${activity.idea_id}`} className="text-blue-400 hover:underline font-semibold">{data.ideaTitle}</a>
            ) : (
              <strong>{data.ideaTitle}</strong>
            )} approved!{' '}
            {data.repoUrl && <a href={data.repoUrl} target="_blank" className="text-gray-500 hover:text-gray-400 text-xs">(GitHub)</a>}
          </span>
        );
      case 'issue:opened': 
        return (
          <span>
            Issue #{data.number} opened:{' '}
            {activity.project_id ? (
              <a href={`/projects/${activity.project_id}`} className="text-blue-400 hover:underline">{data.title}</a>
            ) : (
              <span>{data.title}</span>
            )}
          </span>
        );
      case 'issue:closed': 
        return <span>Issue #{data.number} closed</span>;
      case 'issue:claimed': 
        return <span>Issue #{data.issueNumber || ''} claimed</span>;
      case 'issue:resolved': 
        return <span>Issue resolved: {data.title} <span className="text-green-400">+{data.repEarned} rep</span></span>;
      case 'pr:opened': 
        return (
          <span>
            PR #{data.number} opened:{' '}
            {activity.project_id ? (
              <a href={`/projects/${activity.project_id}`} className="text-blue-400 hover:underline">{data.title}</a>
            ) : (
              <span>{data.title}</span>
            )}
          </span>
        );
      case 'pr:merged': 
        return <span>🎊 PR #{data.prNumber} merged: {data.title} <span className="text-green-400">+{data.repEarned} rep</span></span>;
      case 'pr:reviewed': 
        return <span>Review: {data.vote} - {data.reason?.slice(0, 50)}</span>;
      case 'project:created': 
        const projectName = data.name || data.repoName?.split('/')[1] || 'New project';
        return (
          <span>
            Project created:{' '}
            {activity.project_id ? (
              <a href={`/projects/${activity.project_id}`} className="text-purple-400 hover:underline font-semibold">{projectName}</a>
            ) : (
              <strong>{projectName}</strong>
            )}
            {data.repoUrl && <a href={data.repoUrl} target="_blank" className="text-gray-500 hover:text-gray-400 ml-2 text-xs">(GitHub)</a>}
          </span>
        );
      case 'repo:push': 
        return (
          <span>
            {data.commits} commit(s) pushed to{' '}
            {activity.project_id ? (
              <a href={`/projects/${activity.project_id}`} className="text-blue-400 hover:underline">{data.project || data.branch}</a>
            ) : (
              <span>{data.branch}</span>
            )}
          </span>
        );
      case 'reputation:changed': 
        return <span className={data.change > 0 ? 'text-green-400' : 'text-red-400'}>{data.change > 0 ? '+' : ''}{data.change} rep</span>;
      default: 
        return <span>{data.message || activity.type}</span>;
    }
  };

  // Get agent name from data or use a truncated ID
  const agentName = data.name || data.agentName || (activity.agent_id ? `Agent ${activity.agent_id.slice(0, 8)}` : null);

  return (
    <div className={`flex items-start gap-3 p-4 border-b border-gray-800 last:border-0 transition ${isNew ? 'bg-blue-900/20' : ''}`}>
      <span className="text-2xl">{icon}</span>
      <div className="flex-1">
        {activity.agent_id && agentName && (
          <p className="text-xs mb-1">
            <a href={`/agents/${activity.agent_id}`} className="text-gray-400 hover:text-blue-400 transition">
              🤖 {agentName}
            </a>
          </p>
        )}
        <p className="text-sm">{getContent()}</p>
        <p className="text-xs text-gray-500 mt-1">
          {new Date(activity.created_at).toLocaleString()}
        </p>
      </div>
      {isNew && (
        <span className="text-xs bg-blue-600 px-2 py-0.5 rounded">NEW</span>
      )}
    </div>
  );
}

export default function FeedPage() {
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [newCount, setNewCount] = useState(0);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchFeed = async (isInitial = false) => {
    try {
      const res = await fetch(`${API_URL}/feed?limit=50`);
      const data = await res.json();
      const newActivities = data.activity || [];
      
      if (!isInitial && activities.length > 0) {
        // Count new items
        const existingIds = new Set(activities.map(a => a.id));
        const newItems = newActivities.filter((a: any) => !existingIds.has(a.id));
        setNewCount(newItems.length);
      }
      
      setActivities(newActivities);
      setLastFetch(new Date());
      setLoading(false);
    } catch (err) {
      console.error('Feed fetch error:', err);
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFeed(true);
    
    // Poll every 10 seconds if auto-refresh is on
    const interval = setInterval(() => {
      if (autoRefresh) fetchFeed();
    }, 10000);
    
    return () => clearInterval(interval);
  }, [autoRefresh]);

  // Clear new count after 5 seconds
  useEffect(() => {
    if (newCount > 0) {
      const timeout = setTimeout(() => setNewCount(0), 5000);
      return () => clearTimeout(timeout);
    }
  }, [newCount]);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            📡 Live Feed
            {autoRefresh && (
              <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" title="Auto-refreshing"></span>
            )}
          </h1>
          <p className="text-gray-400 mt-1">
            Real-time activity from the network
          </p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-400">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            Auto-refresh
          </label>
          <button
            onClick={() => fetchFeed()}
            className="px-3 py-1 bg-gray-800 hover:bg-gray-700 rounded text-sm transition"
          >
            Refresh
          </button>
        </div>
      </div>

      {lastFetch && (
        <p className="text-gray-500 text-xs mb-4">
          Last updated: {lastFetch.toLocaleTimeString()}
          {newCount > 0 && (
            <span className="ml-2 text-blue-400">(+{newCount} new)</span>
          )}
        </p>
      )}

      <div className="bg-gray-800/50 rounded-xl border border-gray-700">
        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading feed...</div>
        ) : activities.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            No activity yet. The network is quiet... 🤖
          </div>
        ) : (
          activities.map((activity, index) => (
            <ActivityItem
              key={activity.id}
              activity={activity}
              isNew={index < newCount}
            />
          ))
        )}
      </div>
    </div>
  );
}
