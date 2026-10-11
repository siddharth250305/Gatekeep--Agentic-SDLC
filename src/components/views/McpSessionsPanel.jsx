import { Plug, Activity, Clock, RefreshCw, Circle, Zap } from 'lucide-react'

function timeAgo(dateStr) {
  if (!dateStr) return '—'
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diffMs = now - then
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return `${Math.floor(diffHr / 24)}d ago`
}

const PROVIDER_COLORS = {
  claude: '#e8885a',
  cursor: '#3b82f6',
  openai: '#10a37f',
  gemini: '#4285f4',
}

function providerColor(provider) {
  return PROVIDER_COLORS[provider?.toLowerCase()] || '#86868b'
}

export default function McpSessionsPanel({ sessions = [], stats = null, onRefresh }) {
  const activeSessions = sessions.filter((s) => s.status === 'active')
  const totalToolCalls = stats?.total_tool_calls ?? sessions.reduce((n, s) => n + (s.tool_calls || 0), 0)
  const totalSessions = stats?.total_sessions ?? sessions.length
  const activeCount = stats?.active_sessions ?? activeSessions.length
  const byProvider = stats?.sessions_by_provider || []

  return (
    <div className="card flex flex-col p-6 shadow-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-black/[0.06] pb-3.5">
        <div className="flex items-center gap-2">
          <Plug size={14} className="text-accent" />
          <h3 className="text-[14px] font-semibold text-ink">External Agent Sessions</h3>
        </div>
        <div className="flex items-center gap-2">
          {activeCount > 0 && (
            <span className="rounded-full bg-[#34c759]/15 px-2.5 py-0.5 text-[11px] font-semibold text-[#1f7a37]">
              {activeCount} Active
            </span>
          )}
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="flex h-6 w-6 items-center justify-center rounded-lg hover:bg-black/[0.04] text-faint hover:text-ink transition-colors"
              title="Refresh MCP sessions"
            >
              <RefreshCw size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Stats Row */}
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-black/[0.025] p-2">
          <div className="font-mono text-[13px] font-semibold text-ink">{totalSessions}</div>
          <div className="text-[10px] text-faint uppercase font-medium">Sessions</div>
        </div>
        <div className="rounded-xl bg-black/[0.025] p-2">
          <div className="font-mono text-[13px] font-semibold text-[#1f7a37]">{activeCount}</div>
          <div className="text-[10px] text-faint uppercase font-medium">Active</div>
        </div>
        <div className="rounded-xl bg-black/[0.025] p-2">
          <div className="font-mono text-[13px] font-semibold text-accent">{totalToolCalls}</div>
          <div className="text-[10px] text-faint uppercase font-medium">Tool Calls</div>
        </div>
      </div>

      {/* Provider Breakdown */}
      {byProvider.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {byProvider.map((p) => (
            <span
              key={p.provider}
              className="inline-flex items-center gap-1 rounded-lg bg-black/[0.03] px-2 py-0.5 text-[11px] font-medium text-muted"
            >
              <Circle size={6} fill={providerColor(p.provider)} stroke="none" className="shrink-0" />
              <span className="capitalize">{p.provider}</span>
              <span className="font-semibold text-ink">{p.count}</span>
            </span>
          ))}
        </div>
      )}

      {/* Session List */}
      {sessions.length > 0 ? (
        <div className="mt-4 space-y-2">
          {sessions.slice(0, 5).map((s) => (
            <div
              key={s.session_id}
              className="flex items-center justify-between rounded-xl border border-black/[0.04] bg-black/[0.015] px-3 py-2"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Circle
                  size={8}
                  fill={s.status === 'active' ? '#34c759' : '#86868b'}
                  stroke="none"
                  className="shrink-0"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[12px]">
                    <span className="font-semibold text-ink capitalize">{s.provider || 'unknown'}</span>
                    {s.client && <span className="text-faint">· {s.client}</span>}
                    {s.model && <span className="text-faint truncate">· {s.model}</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-[10.5px] text-muted">
                    <span className="flex items-center gap-0.5">
                      <Zap size={9} className="text-faint" />
                      {s.tool_calls || 0} calls
                    </span>
                    {s.last_tool && (
                      <span className="flex items-center gap-0.5 truncate">
                        <Activity size={9} className="text-faint" />
                        {s.last_tool}
                      </span>
                    )}
                    <span className="flex items-center gap-0.5">
                      <Clock size={9} className="text-faint" />
                      {timeAgo(s.last_tool_at || s.created_at)}
                    </span>
                  </div>
                </div>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  s.status === 'active'
                    ? 'bg-[#34c759]/15 text-[#1f7a37]'
                    : 'bg-black/[0.04] text-faint'
                }`}
              >
                {s.status === 'active' ? 'Live' : 'Ended'}
              </span>
            </div>
          ))}
          {sessions.length > 5 && (
            <div className="text-center text-[11px] text-muted pt-1">
              + {sessions.length - 5} more session{sessions.length - 5 > 1 ? 's' : ''}
            </div>
          )}
        </div>
      ) : (
        /* Empty state */
        <div className="mt-6 flex flex-col items-center text-center py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-black/[0.03]">
            <Plug size={18} className="text-faint" />
          </div>
          <div className="mt-3 text-[13px] font-semibold text-ink">No external agents connected</div>
          <p className="mt-1 max-w-[260px] text-[11.5px] leading-relaxed text-muted">
            Connect Claude, Cursor, or any MCP-compatible client to govern their actions through GateKeep.
          </p>
          <div className="mt-3 rounded-lg bg-black/[0.025] px-3 py-1.5 font-mono text-[10.5px] text-muted">
            mcp run agents/app/mcp/server.py
          </div>
        </div>
      )}
    </div>
  )
}
