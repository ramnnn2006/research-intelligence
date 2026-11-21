import React, { useState, useEffect, useRef } from 'react'
import { api } from '../services/api'
import { useToast } from '../components/Toast'
import RepoList from '../components/RepoList'
import { toText, asArray, safeHttpUrl, parseTimestamp } from '../utils/safe'
import Ic from '../components/Ic'
import useWindowedList from '../useWindowedList'

const TYPE_META = {
  literature_review: { label: 'Literature Review', color: 'var(--accent)', icon: '' },
  survey:            { label: 'Survey',             color: 'var(--purple)', icon: '' },
  gaps:              { label: 'Gap Analysis',        color: 'var(--orange)', icon: '' },
  roadmap:           { label: 'Roadmap',             color: 'var(--green)', icon: '' },
}

function fmtDate(value, opts) {
  const d = parseTimestamp(value)
  return d ? d.toLocaleDateString('en-US', opts) : ''
}

function fmtDateTime(value) {
  const d = parseTimestamp(value)
  return d ? d.toLocaleString() : ''
}

// Survey, gaps and roadmap reports are stored as JSON strings. Older reports may
// hold a Python repr instead, which does not parse, so those are shown raw.
const JSON_REPORT_TYPES = ['survey', 'gaps', 'roadmap']

function parseReport(type, content) {
  if (!JSON_REPORT_TYPES.includes(type)) return null
  if (content && typeof content === 'object') return content
  if (typeof content !== 'string') return null
  const t = content.trim()
  if (!t.startsWith('{') && !t.startsWith('[')) return null
  try { return JSON.parse(t) } catch { return null }
}

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

// Plain text / markdown version of a report, used for the export download
function reportText(type, content) {
  const data = parseReport(type, content)
  if (data == null) return toText(content)
  const lines = []
  const list = items => asArray(items).map(toText).filter(Boolean).forEach(x => lines.push(`- ${x}`))
  if (Array.isArray(data)) {
    asArray(data).map(toText).forEach((g, i) => lines.push(`${i + 1}. ${g}`))
  } else if (type === 'survey' && isPlainObject(data)) {
    if (data.introduction) lines.push('## Introduction', toText(data.introduction), '')
    asArray(data.sections).forEach(sec => lines.push(`## ${toText(sec?.heading)}`, toText(sec?.content), ''))
    if (data.conclusion) lines.push('## Conclusion', toText(data.conclusion), '')
    if (asArray(data.gaps).length) { lines.push('## Research Gaps'); list(data.gaps) }
  } else if (type === 'roadmap' && isPlainObject(data)) {
    if (data.overview) lines.push(toText(data.overview), '')
    asArray(data.phases).forEach(ph => {
      lines.push(`## ${toText(ph?.phase)}${ph?.duration ? ` (${toText(ph.duration)})` : ''}`)
      list(ph?.tasks)
      asArray(ph?.papers).forEach(pp => {
        const title = isPlainObject(pp) ? toText(pp.title) : toText(pp)
        const url = isPlainObject(pp) ? safeHttpUrl(pp.url) : null
        if (title) lines.push(`- Paper: ${title}${url ? ` <${url}>` : ''}`)
      })
      lines.push('')
    })
    if (asArray(data.key_skills).length) { lines.push('## Key Skills'); list(data.key_skills); lines.push('') }
    if (asArray(data.resources).length) { lines.push('## Resources'); list(data.resources) }
  } else {
    return JSON.stringify(data, null, 2)
  }
  return lines.join('\n').trim()
}

const preStyle = { fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontFamily: 'system-ui, sans-serif' }
const h4Style = { color: 'var(--purple)', fontSize: 14, margin: '14px 0 6px', fontWeight: 600 }
const pStyle = { fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.75, margin: 0 }

function TextList({ items, ordered }) {
  const rows = asArray(items).map(toText).filter(Boolean)
  if (!rows.length) return null
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag style={{ paddingLeft: 20, margin: '4px 0', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
      {rows.map((x, i) => <li key={i}>{x}</li>)}
    </Tag>
  )
}

function ReportBody({ type, content }) {
  const data = parseReport(type, content)
  if (data == null) return <pre style={preStyle}>{toText(content)}</pre>

  if (Array.isArray(data)) return <TextList items={data} ordered />

  if (type === 'survey' && isPlainObject(data)) {
    return (
      <div>
        {data.introduction && <p style={pStyle}>{toText(data.introduction)}</p>}
        {asArray(data.sections).map((sec, i) => (
          <div key={i}>
            <h4 style={h4Style}>{toText(sec?.heading)}</h4>
            <p style={pStyle}>{typeof sec === 'string' ? sec : toText(sec?.content)}</p>
          </div>
        ))}
        {data.conclusion && (<><h4 style={h4Style}>Conclusion</h4><p style={pStyle}>{toText(data.conclusion)}</p></>)}
        {asArray(data.gaps).length > 0 && (<><h4 style={h4Style}>Research Gaps</h4><TextList items={data.gaps} /></>)}
      </div>
    )
  }

  if (type === 'roadmap' && isPlainObject(data)) {
    return (
      <div>
        {data.overview && <p style={pStyle}>{toText(data.overview)}</p>}
        {asArray(data.phases).map((ph, i) => (
          <div key={i}>
            <h4 style={h4Style}>
              {toText(ph?.phase) || `Phase ${i + 1}`}
              {ph?.duration && <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 12 }}> · {toText(ph.duration)}</span>}
            </h4>
            <TextList items={ph?.tasks} />
            {asArray(ph?.papers).map((pp, j) => {
              const title = isPlainObject(pp) ? toText(pp.title) : toText(pp)
              const url = isPlainObject(pp) ? safeHttpUrl(pp.url) : null
              if (!title) return null
              return (
                <div key={j} style={{ fontSize: 12, padding: '2px 0' }}>
                  <Ic d="doc" /> {url
                    ? <a href={url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{title}</a>
                    : <span style={{ color: 'var(--muted)' }}>{title}</span>}
                </div>
              )
            })}
          </div>
        ))}
        {asArray(data.key_skills).length > 0 && (<><h4 style={h4Style}>Key Skills</h4><TextList items={data.key_skills} /></>)}
        {asArray(data.resources).length > 0 && (<><h4 style={h4Style}>Resources</h4><TextList items={data.resources} /></>)}
      </div>
    )
  }

  return <pre style={preStyle}>{JSON.stringify(data, null, 2)}</pre>
}

export default function History({ active = true }) {
  const [tab, setTab] = useState('reports')
  const [reports, setReports]   = useState([])
  const [searches, setSearches] = useState([])
  const reportsWin = useWindowedList(asArray(reports), 20)
  const searchesWin = useWindowedList(asArray(searches), 20)
  const [selected, setSelected] = useState(null)
  const detailRef = useRef(null)
  // stacked phone layout: bring the opened item into view, since it sits below the list
  useEffect(() => {
    if (!selected || !detailRef.current || !window.matchMedia('(max-width: 760px)').matches) return
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    detailRef.current.scrollIntoView({ block: 'start', behavior: calm ? 'auto' : 'smooth' })
  }, [selected])
  const [loading, setLoading]   = useState(true)
  const toast = useToast()
  const loadReq = useRef(0)
  const [loadError, setLoadError] = useState('')
  const [storesOffline, setStoresOffline] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  // Every tab stays mounted, so reload whenever this tab is shown to pick up new reports
  useEffect(() => {
    if (!active) return
    const id = ++loadReq.current
    let failure = ''
    Promise.all([
      api.reports().catch(e => { failure = e.message || 'request failed'; return [] }),
      api.searches().catch(e => { failure = e.message || 'request failed'; return [] }),
      api.neo4jStatus().then(x => !!x?.connected).catch(() => null),
      api.mongoStatus().then(x => !!x?.connected).catch(() => null),
    ]).then(([r, s, neo, mongo]) => {
      if (id !== loadReq.current) return
      setReports(Array.isArray(r) ? r : [])
      setSearches(Array.isArray(s) ? s : [])
      setLoadError(failure)
      // only claim "offline" when both status checks answered and both said not connected
      setStoresOffline(neo === false && mongo === false)
      setLoading(false)
    })
  }, [active, reloadKey])

  // deep-link: #history?report=<id> or #history?search=<id> opens that entry,
  // so rows are real anchors and back/forward restores the selection
  useEffect(() => {
    function fromHash() {
      if (!location.hash.startsWith('#history')) return
      const p = new URLSearchParams(location.hash.split('?')[1] || '')
      const rep = p.get('report'), sea = p.get('search')
      if (rep) { setTab('reports'); openReport(rep) }
      else if (sea) { setTab('searches'); const hit = searches.find(x => String(x.id) === String(sea)); if (hit) setSelected({ _type: 'search', ...hit }) }
      else setSelected(null)
    }
    fromHash()
    window.addEventListener('hashchange', fromHash)
    return () => window.removeEventListener('hashchange', fromHash)
  }, [searches])

  // deep-link: #history?report=<id> or #history?search=<id> opens that entry,
  // so rows are real anchors and back/forward restores the selection
  useEffect(() => {
    function fromHash() {
      if (!location.hash.startsWith('#history')) return
      const p = new URLSearchParams(location.hash.split('?')[1] || '')
      const rep = p.get('report'), sea = p.get('search')
      if (rep) { setTab('reports'); openReport(rep) }
      else if (sea) { setTab('searches'); const hit = searches.find(x => String(x.id) === String(sea)); if (hit) setSelected({ _type: 'search', ...hit }) }
      else setSelected(null)
    }
    fromHash()
    window.addEventListener('hashchange', fromHash)
    return () => window.removeEventListener('hashchange', fromHash)
  }, [searches])

  async function openReport(id) {
    try {
      const r = await fetch(`/api/reports/${encodeURIComponent(id)}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setSelected({ _type: 'report', ...(await r.json()) })
    } catch (e) { toast({ message: `Could not open report: ${e.message}`, kind: 'error' }) }
  }

  function exportSelected() {
    if (!selected) return
    const text = selected.content ? reportText(selected.report_type, selected.content) : JSON.stringify(selected, null, 2)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    a.download = `${(selected.topic || selected.query || 'export').replace(/\W+/g, '_')}.txt`
    a.click()
    toast({ message: `Saved ${a.download}`, kind: 'success' })
  }

  const TabBtn = ({ id, label, count }) => (
    <button onClick={() => { setTab(id); setSelected(null) }}
      style={{ background: tab === id ? 'var(--border)' : 'none', border: 'none', borderBottom: `2px solid ${tab === id ? 'var(--accent)' : 'transparent'}`,
        color: tab === id ? 'var(--accent)' : 'var(--muted)', padding: '8px 14px', fontSize: 13,
        fontWeight: 500, cursor: 'pointer', borderRadius: '6px 6px 0 0' }}>
      {label} {count > 0 && <span style={{ background: 'var(--border)', color: 'var(--muted)', borderRadius: 99, padding: '1px 7px', fontSize: 11, marginLeft: 4 }}>{count}</span>}
    </button>
  )

  return (
    <div className="ri-split" style={{ height: '100%' }}>

      {/* Left sidebar */}
      <div className="ri-side" style={{ width: 300, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px 0', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <h2 className="ri-title" style={{ fontSize: 17, marginBottom: 10 }}>History</h2>
          <div style={{ display: 'flex', gap: 2 }}>
            <TabBtn id="reports"  label="Reports"  count={reports.length} />
            <TabBtn id="searches" label="Searches" count={searches.length} />
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {loading && <p style={{ color: 'var(--muted)', fontSize: 13, padding: 4 }}>Loading…</p>}
          {!loading && loadError && (
            <div role="alert" style={{ fontSize: 13, color: 'var(--red-strong)', background: 'rgba(193,59,46,.08)', border: '1px solid rgba(193,59,46,.25)', borderRadius: 7, padding: '8px 10px', marginBottom: 10 }}>
              Could not load history: {loadError}
              <div><button onClick={() => { setLoading(true); setReloadKey(k => k + 1) }} style={{ marginTop: 6, background: 'none', border: '1px solid var(--red)', color: 'var(--red-strong)', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>Try again</button></div>
            </div>
          )}
          {!loading && !loadError && storesOffline && (
            <p style={{ color: 'var(--muted)', fontSize: 12, lineHeight: 1.5, padding: '0 4px 10px' }}>
              Neo4j and MongoDB are both offline, so this list only holds items from the current server session.
            </p>
          )}

          {/* Reports tab */}
          {!loading && !loadError && tab === 'reports' && (
            reports.length === 0
              ? <p style={{ color: 'var(--muted2)', fontSize: 13, lineHeight: 1.6, padding: 4 }}>
                  No reports yet. Use Review, Survey, Gaps, or Roadmap to generate some.
                </p>
              : reportsWin.visible.map(r => {
                  const meta = TYPE_META[r.report_type] || { label: r.report_type, color: 'var(--muted)', icon: '' }
                  const isActive = selected?._type === 'report' && selected?.id === r.id
                  return (
                    <a key={r.id} href={'#history?report=' + encodeURIComponent(r.id)} className="ri-hist-row"
                      style={{ display: 'block', textDecoration: 'none', color: 'inherit', background: isActive ? 'var(--panel2)' : 'none', border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 7, padding: '10px 12px', cursor: 'pointer', marginBottom: 8, transition: 'background-color .15s, border-color .15s, color .15s, box-shadow .15s' }}
                      onMouseEnter={e => { if (!isActive) e.currentTarget.style.borderColor = 'var(--border2)' }}
                      onMouseLeave={e => { if (!isActive) e.currentTarget.style.borderColor = 'var(--border)' }}>
                      <div style={{ marginBottom: 5 }}>
                        <span style={{ background: `color-mix(in srgb, ${meta.color} 9.4%, transparent)`, color: meta.color, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>
                          {meta.label}
                        </span>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.4, marginBottom: 3 }}>{r.topic}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted2)' }}>
                        {fmtDate(r.created_at, { month: 'short', day: 'numeric', year: 'numeric' })}
                      </div>
                    </a>
                  )
                })
          )}
          {tab === 'reports' && reportsWin.hasMore && (
            <div ref={reportsWin.sentinelRef} style={{ padding: 12, textAlign: 'center', color: 'var(--muted2)', fontSize: 12 }}>
              Showing {reportsWin.shown} of {reportsWin.total} reports…
            </div>
          )}

          {/* Searches tab */}
          {!loading && !loadError && tab === 'searches' && (
            searches.length === 0
              ? <p style={{ color: 'var(--muted2)', fontSize: 13, lineHeight: 1.6, padding: 4 }}>
                  No searches yet. Use the Discover tab to search for papers.
                </p>
              : searchesWin.visible.map((s, i) => {
                  const isActive = selected?._type === 'search' && selected?.id === s.id
                  return (
                    <a key={i} href={'#history?search=' + encodeURIComponent(s.id)} className="ri-hist-row"
                      style={{ display: 'block', textDecoration: 'none', color: 'inherit', background: isActive ? 'var(--panel2)' : 'none', border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 7, padding: '10px 12px', cursor: 'pointer', marginBottom: 8, transition: 'background-color .15s, border-color .15s, color .15s, box-shadow .15s' }}
                      onMouseEnter={e => { if (!isActive) e.currentTarget.style.borderColor = 'var(--border2)' }}
                      onMouseLeave={e => { if (!isActive) e.currentTarget.style.borderColor = 'var(--border)' }}>
                      <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 3 }}><Ic d="search" /> {s.query}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted2)', display: 'flex', gap: 8 }}>
                        {s.repos?.length > 0 && <span><Ic d="wrench" /> {s.repos.length} repos</span>}
                        <span>{fmtDate(s.created_at, { month: 'short', day: 'numeric' })}</span>
                      </div>
                    </a>
                  )
                })
          )}
          {tab === 'searches' && searchesWin.hasMore && (
            <div ref={searchesWin.sentinelRef} style={{ padding: 12, textAlign: 'center', color: 'var(--muted2)', fontSize: 12 }}>
              Showing {searchesWin.shown} of {searchesWin.total} searches…
            </div>
          )}
        </div>
      </div>

      {/* Right content pane */}
      <div ref={detailRef} style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selected ? (
          <div className="ri-empty-detail" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', flexDirection: 'column', gap: 8, color: 'var(--muted)' }}>
            <div style={{ color: 'var(--muted2)' }}><Ic d="clip" size={32} /></div>
            <div style={{ fontSize: 14 }}>Select an item from the list to view it</div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={{ borderBottom: '1px solid var(--border)', padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text)' }}>
                  {selected._type === 'report' ? selected.topic : `Search: ${selected.query}`}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted2)', marginTop: 2 }}>
                  {selected._type === 'report'
                    ? `${TYPE_META[selected.report_type]?.label || selected.report_type} · ${fmtDateTime(selected.created_at)}`
                    : fmtDateTime(selected.created_at)
                  }
                </div>
              </div>
              {selected._type === 'report' && (
                <button onClick={exportSelected}
                  style={{ background: 'none', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>
                  ⬇ Export
                </button>
              )}
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>

              {/* Report: show content + repos + papers */}
              {selected._type === 'report' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                  <ReportBody type={selected.report_type} content={selected.content} />

                  {/* Papers saved with report */}
                  {selected.papers?.length > 0 && (
                    <div>
                      <h3 style={{ fontSize: 14, color: 'var(--accent)', marginBottom: 12 }}><Ic d="doc" /> Papers ({selected.papers.length})</h3>
                      {selected.papers.map((p, i) => (
                        <div key={i} style={{ paddingBottom: 8, marginBottom: 8, borderBottom: i < selected.papers.length - 1 ? '1px solid var(--border)' : 'none' }}>
                          <a href={p.url || p.id} target="_blank" rel="noreferrer"
                            style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none' }}
                            onMouseEnter={e => e.target.style.textDecoration = 'underline'}
                            onMouseLeave={e => e.target.style.textDecoration = 'none'}>
                            {p.title}
                          </a>
                          <div style={{ fontSize: 11, color: 'var(--muted2)', marginTop: 2 }}>
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
                  ? <RepoList repos={selected.repos} title={`Repos for "${selected.query}"`} />
                  : <p style={{ color: 'var(--muted2)', fontSize: 13 }}>No GitHub repos found for this search.</p>
              )}

            </div>
          </>
        )}
      </div>
    </div>
  )
}
