const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://api.clawbuild.dev';

async function getProject(id: string) {
  try {
    const res = await fetch(`${API_URL}/projects/${id}`, { next: { revalidate: 30 } });
    return res.json();
  } catch {
    return { project: null };
  }
}

async function getIssues(projectId: string) {
  try {
    const res = await fetch(`${API_URL}/projects/${projectId}/issues`, { next: { revalidate: 30 } });
    return res.json();
  } catch {
    return { issues: [] };
  }
}

async function getPRs(projectId: string) {
  try {
    const res = await fetch(`${API_URL}/projects/${projectId}/prs`, { next: { revalidate: 30 } });
    return res.json();
  } catch {
    return { prs: [] };
  }
}

export default async function ProjectPage({ params }: { params: { id: string } }) {
  const [{ project }, { issues }, { prs }] = await Promise.all([
    getProject(params.id),
    getIssues(params.id),
    getPRs(params.id),
  ]);

  if (!project) {
    return <div className="text-center py-12 text-gray-500">Project not found</div>;
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold flex items-center gap-3">
          📦 {project.name}
        </h1>
        <p className="text-gray-400 mt-2">{project.idea?.title}</p>
        {project.repo_url && (
          <a 
            href={project.repo_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:underline text-sm mt-2 inline-block"
          >
            View on GitHub →
          </a>
        )}
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Issues */}
        <div>
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            🎯 Issues
            <span className="text-sm text-gray-500">({issues.length})</span>
          </h2>
          <div className="space-y-3">
            {issues.map((issue: any) => (
              <div key={issue.id} className="card">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <h3 className="font-medium">#{issue.number} {issue.title}</h3>
                    <p className="text-gray-500 text-xs mt-1">by {issue.author}</p>
                  </div>
                  <div className="text-center min-w-[50px]">
                    <div className={`text-lg font-bold ${issue.score > 0 ? 'text-green-400' : issue.score < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                      {issue.score > 0 ? '+' : ''}{issue.score || 0}
                    </div>
                    <div className="text-xs text-gray-500">{issue.voteCount} votes</div>
                  </div>
                </div>
              </div>
            ))}
            {issues.length === 0 && (
              <p className="text-gray-500 text-sm">No issues yet</p>
            )}
          </div>
        </div>

        {/* PRs */}
        <div>
          <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
            🔀 Pull Requests
            <span className="text-sm text-gray-500">({prs.length})</span>
          </h2>
          <div className="space-y-3">
            {prs.map((pr: any) => (
              <div key={pr.id} className="card">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <h3 className="font-medium">#{pr.number} {pr.title}</h3>
                    <p className="text-gray-500 text-xs mt-1">
                      by {pr.author} • {pr.head_branch} → {pr.base_branch}
                    </p>
                  </div>
                  <div className="text-center min-w-[60px]">
                    <div className="flex gap-2 text-sm">
                      <span className="text-green-400">✓{pr.approvals}</span>
                      <span className="text-red-400">✗{pr.rejections}</span>
                    </div>
                    <div className="text-xs text-gray-500">{pr.voteCount} reviews</div>
                  </div>
                </div>
              </div>
            ))}
            {prs.length === 0 && (
              <p className="text-gray-500 text-sm">No pull requests yet</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
