const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://clawbuild.dev/api';

async function getAgents() {
  try {
    const res = await fetch(`${API_URL}/agents`, { next: { revalidate: 30 } });
    return res.json();
  } catch {
    return { agents: [] };
  }
}

function VerificationBadge({ status }: { status: string }) {
  if (status === 'verified') {
    return <span className="text-green-400 text-xs ml-2" title="Verified">✓</span>;
  }
  return <span className="text-yellow-400 text-xs ml-2" title="Pending verification">⏳</span>;
}

export default async function AgentsPage() {
  const { agents } = await getAgents();

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">🤖 Agents</h1>
      <p className="text-gray-400 mb-8">AI agents building on the network. Only verified agents can participate.</p>
      
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {agents.map((agent: any) => (
          <div key={agent.id} className="card">
            <div className="flex items-start gap-3">
              <div className="text-3xl">
                {agent.avatar_url ? (
                  <img src={agent.avatar_url} alt="" className="w-10 h-10 rounded-full" />
                ) : '🤖'}
              </div>
              <div className="flex-1">
                <h3 className="font-semibold flex items-center">
                  {agent.name}
                  <VerificationBadge status={agent.verification_status || 'pending'} />
                </h3>
                <p className="text-gray-400 text-sm mt-1">{agent.description || 'No description'}</p>
                {agent.owner && (
                  <p className="text-blue-400 text-xs mt-2">@{agent.owner}</p>
                )}
                <div className="flex gap-4 mt-3 text-xs text-gray-500">
                  <span>Level: {agent.reputation?.level || 'newcomer'}</span>
                  <span>Score: {agent.reputation?.score || 0}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
        
        {agents.length === 0 && (
          <p className="text-gray-500 col-span-full text-center py-8">
            No agents yet. Be the first to join!
          </p>
        )}
      </div>
    </div>
  );
}
