import React, { useState, useEffect } from 'react'
import { api } from '../services/api'
import RepoList from '../components/RepoList'

const TYPE_META = {
  literature_review: { label: 'Literature Review', color: '#58a6ff', icon: '📖' },
  survey:            { label: 'Survey',             color: '#bc8cff', icon: '📚' },
  gaps:              { label: 'Gap Analysis',        color: '#e3b341', icon: '💡' },
  roadmap:           { label: 'Roadmap',             color: '#3fb950', icon: '🗺️' },
}

export default function History() {
  const [tab, setTab] = useState('reports')
  const [reports, setReports]   = useState([])
  const [searches, setSearches] = useState([])
  const [selected, setSelected] = useState(null)
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    Promise.all([
      api.reports().catch(() => []),
      api.searches().catch(() => []),
    ]).then(([r, s]) => {
      setReports(Array.isArray(r) ? r : [])
      setSearches(Array.isArray(s) ? s : [])
      setLoading(false)
    })
  }, [])

  async function openReport(id) {
    try {
      const r = await fetch(`/api/reports/${id}`)
      if (!r.ok) return
      setSelected({ _type: 'report', ...(await r.json()) })
    } catch {}
  }

  function exportSelected() {
    if (!selected) return
    const text = selected.content || JSON.stringify(selected, null, 2)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    a.download = `${(selected.topic || selected.query || 'export').replace(/\W+/g, '_')}.txt`
    a.click()
  }

  const TabBtn = ({ id, label, count }) => (
    <button onClick={() => { setTab(id); setSelected(null) }}
      style={{ background: tab === id ? '#21262d' : 'none', border: 'none', borderBottom: `2px solid ${tab === id ? '#58a6ff' : 'transparent'}`,
        color: tab === id ? '#58a6ff' : '#8b949e', padding: '8px 14px', fontSize: 13,
        fontWeight: 500, cursor: 'pointer', borderRadius: '6px 6px 0 0' }}>
      {label} {count > 0 && <span style={{ background: '#21262d', color: '#8b949e', borderRadius: 99, padding: '1px 7px', fontSize: 11, marginLeft: 4 }}>{count}</span>}
    </button>
  )

  return (
    <div style={{ height: '100%', display: 'flex', overflow: 'hidden' }}>

      {/* Left sidebar */}
      <div style={{ width: 300, flexShrink: 0, borderRight: '1px solid #21262d', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px 0', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
          <h2 style={{ fontSize: 15, marginBottom: 10 }}>🗂️ History</h2>
          <div style={{ display: 'flex', gap: 2 }}>
            <TabBtn id="reports"  label="Reports"  count={reports.length} />
            <TabBtn id="searches" label="Searches" count={searches.length} />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {loading && <p style={{ color: '#8b949e', fontSize: 13, padding: 4 }}>Loading…</p>}

          {/* Reports tab */}
          {!loading && tab === 'reports' && (
            reports.length === 0
              ? <p style={{ color: '#6e7681', fontSize: 13, lineHeight: 1.6, padding: 4 }}>
                  No reports yet. Use Review, Survey, Gaps, or Roadmap to generate some.
                </p>
              : reports.map(r => {
                  const meta = TYPE_META[r.report_type] || { label: r.report_type, color: '#8b949e', icon: '📄' }
                  const isActive = selected?._type === 'report' && selected?.id === r.id
                  return (
                    <div key={r.id} onClick={() => openReport(r.id)}
                      style={{ background: isActive ? '#161b22' : 'none', border: `1px solid ${isActive ? '#58a6ff' : '#21262d'}`, borderRadius: 7, padding: '10px 12px', cursor: 'pointer', marginBottom: 8, transition: 'all .15s' }}
                      onMouseEnter={e => { if (!isActive) e.currentTarget.style.borderColor = '#30363d' }}
                      onMouseLeave={e => { if (!isActive) e.currentTarget.style.borderColor = '#21262d' }}>
                      <div style={{ marginBottom: 5 }}>
                        <span style={{ background: `${meta.color}18`, color: meta.color, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
                          {meta.icon} {meta.label}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, color: '#e6edf3', lineHeight: 1.4, marginBottom: 3 }}>{r.topic}</div>
                      <div style={{ fontSize: 11, color: '#6e7681' }}>
                        {new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </div>
                    </div>
                  )
                })
          )}

          {/* Searches tab */}
          {!loading && tab === 'searches' && (
            searches.length === 0
              ? <p style={{ color: '#6e7681', fontSize: 13, lineHeight: 1.6, padding: 4 }}>
                  No searches yet. Use the Discover tab to search for papers.
                </p>
              : searches.map((s, i) => {
                  const isActive = selected?._type === 'search' && selected?.id === s.id
                  return (
                    <div key={i} onClick={() => setSelected({ _type: 'search', ...s })}
                      style={{ background: isActive ? '#161b22' : 'none', border: `1px solid ${isActive ? '#58a6ff' : '#21262d'}`, borderRadius: 7, padding: '10px 12px', cursor: 'pointer', marginBottom: 8, transition: 'all .15s' }}
                      onMouseEnter={e => { if (!isActive) e.currentTarget.style.borderColor = '#30363d' }}
                      onMouseLeave={e => { if (!isActive) e.currentTarget.style.borderColor = '#21262d' }}>
                      <div style={{ fontSize: 13, color: '#e6edf3', marginBottom: 3 }}>🔍 {s.query}</div>
                      <div style={{ fontSize: 11, color: '#6e7681', display: 'flex', gap: 8 }}>
                        {s.repos?.length > 0 && <span>🔧 {s.repos.length} repos</span>}
                        <span>{new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                      </div>
                    </div>
                  )
                })
          )}
        </div>
      </div>

      {/* Right content pane */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selected ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 8, color: '#8b949e' }}>
            <div style={{ fontSize: 36 }}>📋</div>
            <div style={{ fontSize: 14 }}>Select an item from the list to view it</div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={{ borderBottom: '1px solid #21262d', padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#e6edf3' }}>
                  {selected._type === 'report' ? selected.topic : `Search: ${selected.query}`}
                </div>
                <div style={{ fontSize: 12, color: '#6e7681', marginTop: 2 }}>
                  {selected._type === 'report'
                    ? `${TYPE_META[selected.report_type]?.label || selected.report_type} · ${new Date(selected.created_at).toLocaleString()}`
                    : `${new Date(selected.created_at).toLocaleString()}`
                  }
                </div>
              </div>
              {selected._type === 'report' && (
                <button onClick={exportSelected}
                  style={{ background: 'none', border: '1px solid #58a6ff', color: '#58a6ff', borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>
                  ⬇ Export
                </button>
              )}
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>

              {/* Report: show content + repos + papers */}
              {selected._type === 'report' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  <pre style={{ fontSize: 13, color: '#c9d1d9', lineHeight: 1.8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontFamily: 'system-ui, sans-serif' }}>
                    {selected.content}
                  </pre>

                  {/* Papers saved with report */}
                  {selected.papers?.length > 0 && (
                    <div>
                      <h3 style={{ fontSize: 14, color: '#58a6ff', marginBottom: 12 }}>📄 Papers ({selected.papers.length})</h3>
                      {selected.papers.map((p, i) => (
                        <div key={i} style={{ paddingBottom: 8, marginBottom: 8, borderBottom: i < selected.papers.length - 1 ? '1px solid #21262d' : 'none' }}>
                          <a href={p.url || p.id} target="_blank" rel="noreferrer"
                            style={{ fontSize: 13, color: '#58a6ff', textDecoration: 'none' }}
                            onMouseEnter={e => e.target.style.textDecoration = 'underline'}
                            onMouseLeave={e => e.target.style.textDecoration = 'none'}>
                            {p.title}
                          </a>
                          <div style={{ fontSize: 11, color: '#6e7681', marginTop: 2 }}>
                            {(p.authors || []).slice(0, 3).join(', ')}
                            {p.year ? ` · ${p.year}` : ''}
                            {p.citations ? ` · ${p.citations} citations` : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Repos saved with report */}
                  {selected.repos?.length > 0 && (
                    <RepoList repos={selected.repos} />
                  )}
                </div>
              )}

              {selected._type === 'search' && (
                selected.repos?.length > 0
                  ? <RepoList repos={selected.repos} title={`🔧 Repos for "${selected.query}"`} />
                  : <p style={{ color: '#6e7681', fontSize: 13 }}>No GitHub repos found for this search.</p>
              )}

            </div>
          </>
        )}
      </div>
    </div>
  )
}
