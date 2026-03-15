import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { getRoot, getHealth } from '../api'
import type { RootStatus, HealthStatus } from '../api'

function statusBadge(s: string) {
  if (s === 'healthy' || s === 'ok') return <span className="badge badge-ok">{s}</span>
  if (s === 'degraded')              return <span className="badge badge-warn">{s}</span>
  return                                    <span className="badge badge-error">{s}</span>
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="kv-row">
      <span className="kv-key">{k}</span>
      <span className="kv-val">{v}</span>
    </div>
  )
}

export default function HealthTab() {
  const [root,    setRoot]    = useState<RootStatus | null>(null)
  const [health,  setHealth]  = useState<HealthStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [err,     setErr]     = useState('')

  async function refresh() {
    setLoading(true); setErr('')
    try {
      const [r, h] = await Promise.all([getRoot(), getHealth()])
      setRoot(r); setHealth(h)
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Service Health</h2>
        <button className="btn btn-outline btn-sm" onClick={refresh} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} />
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {err && <div className="error-box">{err}</div>}

      <div className="health-grid">
        {/* GET / */}
        <div className="card">
          <p className="card-title">GET /</p>
          {root ? (
            <>
              <KV k="status"    v={statusBadge(root.status)} />
              <KV k="service"   v={root.service} />
              <KV k="version"   v={root.version} />
              <KV k="mock_mode" v={root.mock_mode ? <span className="badge badge-warn">ON</span> : <span className="badge badge-ok">OFF</span>} />
              <KV k="rag_status" v={<span className="badge badge-info">{root.rag_status}</span>} />
            </>
          ) : (
            <p className="muted">{loading ? 'Loading…' : '—'}</p>
          )}
        </div>

        {/* GET /health */}
        <div className="card">
          <p className="card-title">GET /health</p>
          {health ? (
            <>
              <KV k="status"           v={statusBadge(health.status)} />
              <KV k="rag_available"    v={health.rag_available
                ? <span className="badge badge-ok">yes</span>
                : <span className="badge badge-error">no</span>} />
              {health.rag_model_status && <KV k="model_status" v={health.rag_model_status} />}
              {health.indexed_chunks !== undefined && <KV k="indexed_chunks" v={health.indexed_chunks} />}
              {health.rag_import_error && (
                <KV k="import_error" v={<span style={{ color: 'var(--danger)', fontSize: '.78rem' }}>{health.rag_import_error}</span>} />
              )}
              {health.fix && <KV k="fix" v={<code style={{ fontSize: '.78rem', color: 'var(--accent2)' }}>{health.fix}</code>} />}
              {health.detail && <KV k="detail" v={health.detail} />}
            </>
          ) : (
            <p className="muted">{loading ? 'Loading…' : '—'}</p>
          )}
        </div>
      </div>
    </div>
  )
}
