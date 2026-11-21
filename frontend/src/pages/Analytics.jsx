import React, { useState, useEffect, useRef } from 'react'
import { api } from '../services/api'
import Spinner from '../components/Spinner'

const LABEL_COLORS = {
  Paper: 'var(--muted)', Author: 'var(--orange)', Repository: 'var(--purple)', Topic: 'var(--accent)',
  Search: 'var(--green)', Report: 'var(--red)',
}

// endpoints timed by the latency benchmark, all read-only
const BENCH = [
  { name: 'Co-authorship network',     path: '/db/queries/coauthorship?limit=10' },
  { name: 'Paper to code matching',    path: '/db/queries/paper-code?limit=10' },
  { name: 'In-degree centrality',      path: '/db/queries/indegree-centrality' },
  { name: 'Topic citation aggregation', path: '/db/queries/topic-distribution' },
  { name: 'Author productivity',       path: '/db/queries/author-productivity' },
  { name: '2-hop topic subgraph',      path: '/graph/export/json?scope=topic&depth=2' },
]

const card = { background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }

function BarChart({ rows, keyField, unavailable }) {
  const max = Math.max(1, ...rows.map(r => r.count))
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map(r => (
        <div key={r[keyField]} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 50px', alignItems: 'center', gap: 10, fontSize: 12 }}>
          <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r[keyField]}</span>
          <div style={{ background: 'var(--panel)', borderRadius: 4, height: 14 }}>
            <div style={{ width: `${(r.count / max) * 100}%`, height: '100%', borderRadius: 4, background: LABEL_COLORS[r[keyField]] || 'var(--accent)' }} />
          </div>
          <span style={{ color: 'var(--muted)', textAlign: 'right' }}>{r.count.toLocaleString()}</span>
        </div>
      ))}
      {rows.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 12 }}>{unavailable ? 'Unavailable while Neo4j is offline' : 'Nothing stored yet'}</div>}
    </div>
  )
}

export default function Analytics({ active = true }) {
  const [stats, setStats]     = useState(null)
  const [health, setHealth]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [bench, setBench]     = useState([])
  const [benchRunning, setBenchRunning] = useState(false)

  async function load() {
    setLoading(true)
    const [s, h] = await Promise.all([
      api.dbStats().catch(() => null),
      fetch('/api/db/health').then(r => r.json()).catch(() => null),
    ])
    setStats(s); setHealth(h); setLoading(false)
  }

  // the tab stays mounted while hidden; load once it is first shown, not at app entry
  const loadedOnce = useRef(false)
  useEffect(() => {
    if (!active || loadedOnce.current) return
    loadedOnce.current = true
    load()
  }, [active])

  async function runBenchmark() {
    setBenchRunning(true); setBench([])
    const out = []
    for (const q of BENCH) {
      const t0 = performance.now()
      try {
        const r = await fetch('/api' + q.path)
        const body = await r.json()
        const rows = Array.isArray(body.results) ? body.results.length : (body.nodes?.length ?? 0)
        out.push({ ...q, ms: performance.now() - t0, rows, ok: r.ok })
      } catch {
        out.push({ ...q, ms: performance.now() - t0, rows: 0, ok: false })
      }
      setBench([...out])
    }
    setBenchRunning(false)
  }

  const online = health?.status === 'healthy'
  const known = online && stats?.connected !== false   // counts are only real when Neo4j answered
  const cards = [
    ['Papers', known ? stats?.papers : null], ['Authors', known ? stats?.authors : null], ['Repositories', known ? stats?.repositories : null],
    ['Topics', known ? stats?.topics : null], ['Relationships', known ? stats?.total_relationships : null],
    ['Heap used', health?.memory?.available ? `${health.memory.heap_used_mb}\u00A0MB` : 'n/a'],
  ]

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 className="ri-title" style={{ fontSize: 18 }}>Graph Analytics</h2>
        {health && (
          <span style={{ fontSize: 12, padding: '3px 10px', borderRadius: 99, background: online ? 'rgba(var(--green-rgb),.12)' : 'rgba(193,59,46,.12)', color: online ? 'var(--green)' : 'var(--red-strong)' }}>
            Neo4j {health.status}{health.latency_ms != null && ` · ${health.latency_ms} ms`}
          </span>
        )}
        <button onClick={load} disabled={loading}
          style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--border2)', borderRadius: 6, color: 'var(--muted)', padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}>
          {loading ? <><Spinner />Loading…</> : '↻ Refresh'}
        </button>
      </div>

      {!loading && !stats && !health && (
        <div role="alert" style={{ fontSize: 13, color: 'var(--red-strong)' }}>Could not reach the server for analytics. Try Refresh.</div>
      )}
      {!loading && health && !online && (
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          Neo4j is offline, so these figures are unavailable (shown as a dash){health.detail ? `. Server detail: ${health.detail}` : ''}.
        </div>
      )}

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
        {cards.map(([label, value]) => (
          <div key={label} style={card}>
            <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 600 }}>{value == null ? '–' : value.toLocaleString()}</div>
          </div>
        ))}
      </div>

      {/* Distribution charts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <div style={card}>
          <h3 style={{ fontSize: 13, marginBottom: 12 }}>Node distribution by label</h3>
          <BarChart rows={health?.nodes?.by_label || []} keyField="label" unavailable={!online} />
        </div>
        <div style={card}>
          <h3 style={{ fontSize: 13, marginBottom: 12 }}>Relationships by type</h3>
          <BarChart rows={health?.relationships?.by_type || []} keyField="type" unavailable={!online} />
        </div>
      </div>

      {/* Latency benchmark */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: 13 }}>Query latency benchmark</h3>
          <button onClick={runBenchmark} disabled={benchRunning}
            style={{ marginLeft: 'auto', background: benchRunning ? 'var(--border)' : 'var(--accent)', color: benchRunning ? 'var(--muted)' : 'var(--on-accent)', border: 'none', borderRadius: 6, padding: '5px 14px', fontSize: 12, fontWeight: 600, cursor: benchRunning ? 'not-allowed' : 'pointer' }}>
            {benchRunning ? <><Spinner />Running…</> : 'Run benchmark'}
          </button>
        </div>
        <div style={{ overflowX: "auto" }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ color: 'var(--muted)', textAlign: 'left' }}>
              <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>Query</th>
              <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>Endpoint</th>
              <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', textAlign: 'right' }}>Rows</th>
              <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', textAlign: 'right' }}>Latency</th>
            </tr>
          </thead>
          <tbody>
            {bench.map(b => (
              <tr key={b.path}>
                <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--panel2)' }}>{b.name}</td>
                <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--panel2)', color: 'var(--muted2)', fontFamily: 'monospace' }}>{b.path.split('?')[0]}</td>
                <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--panel2)', textAlign: 'right' }}>{b.ok ? b.rows : 'error'}</td>
                <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--panel2)', textAlign: 'right', color: b.ms > 500 ? 'var(--orange)' : 'var(--green)' }}>{b.ms.toFixed(1)} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {bench.length === 0 && !benchRunning && (
          <div style={{ color: 'var(--muted2)', fontSize: 12, padding: '10px 8px' }}>Times each graph query endpoint once from the browser, network round trip included.</div>
        )}
      </div>

      {/* Index advisor */}
      {health?.index_advice?.length > 0 && (
        <div style={card}>
          <h3 style={{ fontSize: 13, marginBottom: 10 }}>Index advisor</h3>
          {health.index_advice.map((a, i) => (
            <div key={i} style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-secondary)', padding: '4px 0' }}>{a.suggestion}</div>
          ))}
        </div>
      )}
    </div>
  )
}
