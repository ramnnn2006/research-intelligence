import React, { useState, useEffect } from 'react'
import { api } from '../services/api'
import { useTopicContext } from '../App'
import Spinner from '../components/Spinner'
import RepoList from '../components/RepoList'

const PC = ['#58a6ff', '#bc8cff', '#3fb950', '#e3b341']

export default function Roadmap() {
  const { topic: globalTopic, setTopic: setGlobalTopic } = useTopicContext()
  const [topic, setTopic] = useState(globalTopic || '')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => { if (globalTopic && !topic) setTopic(globalTopic) }, [globalTopic])

  async function run() {
    if (!topic.trim() || loading) return
    setGlobalTopic(topic)
    setLoading(true); setError(''); setResult(null)
    try { setResult(await api.roadmap(topic)) }
    catch (e) { setError(e.message) }
    setLoading(false)
  }

  const r = result?.roadmap
  // Build a title→paper lookup so phase papers get clickable links
  const paperIndex = {}
  ;(result?.papers || []).forEach(p => {
    const key = (p.title || '').toLowerCase().substring(0, 50)
    if (key) paperIndex[key] = p
  })

  function findPaper(title) {
    const key = (title || '').toLowerCase().substring(0, 50)
    // Exact match first
    if (paperIndex[key]) return paperIndex[key]
    // Fuzzy: find any paper whose title contains the first 20 chars of this title
    const prefix = key.substring(0, 20)
    return Object.values(paperIndex).find(p =>
      (p.title || '').toLowerCase().includes(prefix)
    ) || null
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Input */}
      <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: 20, flexShrink: 0 }}>
        <h2 style={{ fontSize: 16, marginBottom: 4 }}>🗺️ Research Roadmap Generator</h2>
        <p style={{ color: '#8b949e', fontSize: 13, marginBottom: 14 }}>
          Structured learning plan with phases, tasks, key papers, and skills
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            value={topic} onChange={e => setTopic(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && run()}
            placeholder="e.g. multimodal learning for robotics"
            style={{ flex: 1, background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, color: '#e6edf3', padding: '8px 12px', fontSize: 14, outline: 'none' }}
            onFocus={e => e.target.style.borderColor = '#58a6ff'}
            onBlur={e => e.target.style.borderColor = '#30363d'}
          />
          <button onClick={run} disabled={loading || !topic.trim()}
            style={{ background: loading ? '#21262d' : '#58a6ff', color: loading ? '#8b949e' : '#000', border: 'none', borderRadius: 6, padding: '8px 20px', fontWeight: 600, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer' }}>
            {loading ? <><Spinner />Building…</> : 'Build Roadmap'}
          </button>
        </div>
        {error && <div style={{ marginTop: 10, color: '#f85149', fontSize: 13, background: 'rgba(248,81,73,.08)', padding: '8px 12px', borderRadius: 6 }}>⚠️ {error}</div>}
        {loading && <p style={{ color: '#8b949e', fontSize: 12, marginTop: 8 }}>Fetching papers and building roadmap — ~20s…</p>}
      </div>

      {r && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 16, alignItems: 'start' }}>

          {/* Phases */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {r.overview && (
              <div style={{ background: '#161b22', border: '1px solid #21262d', borderLeft: '3px solid #58a6ff', borderRadius: 8, padding: '14px 16px', fontSize: 13, color: '#8b949e', lineHeight: 1.7 }}>
                {r.overview}
              </div>
            )}

            {(r.phases || []).map((phase, i) => (
              <div key={i} style={{ background: '#161b22', border: '1px solid #21262d', borderLeft: `3px solid ${PC[i % 4]}`, borderRadius: 8, padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                  <span style={{ background: `${PC[i % 4]}18`, color: PC[i % 4], padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 700 }}>
                    Phase {i + 1}
                  </span>
                  <span style={{ fontWeight: 600, fontSize: 14, color: '#e6edf3' }}>
                    {(phase.phase || '').replace(/^Phase \d+[:\-\s]*/i, '')}
                  </span>
                  {phase.duration && (
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#8b949e', background: '#0d1117', padding: '2px 8px', borderRadius: 4 }}>
                      ⏱ {phase.duration}
                    </span>
                  )}
                </div>

                {/* Tasks */}
                {phase.tasks?.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, color: '#6e7681', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Tasks</div>
                    {phase.tasks.map((t, j) => (
                      <div key={j} style={{ display: 'flex', gap: 8, fontSize: 13, color: '#c9d1d9', marginBottom: 6, lineHeight: 1.55 }}>
                        <span style={{ color: PC[i % 4], flexShrink: 0, marginTop: 1 }}>▸</span>
                        {t}
                      </div>
                    ))}
                  </div>
                )}

                {/* Key Papers — with direct URLs from LLM */}
                {phase.papers?.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, color: '#6e7681', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Key Papers</div>
                    {phase.papers.map((p, j) => {
                      // LLM now returns {title, url} objects; fallback to string + fuzzy match
                      const pTitle = typeof p === 'object' ? (p.title || '') : p
                      const pUrl   = typeof p === 'object' ? (p.url || '') : ''
                      const matched = pUrl ? null : findPaper(pTitle)
                      const url = pUrl || (matched ? (matched.url || matched.id) : null)
                      const meta = matched || (typeof p === 'object' ? p : null)
                      return (
                        <div key={j} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', borderBottom: j < phase.papers.length - 1 ? '1px solid #21262d' : 'none' }}>
                          <span style={{ color: '#e3b341', flexShrink: 0 }}>📄</span>
                          <div style={{ flex: 1 }}>
                            {url ? (
                              <a href={url} target="_blank" rel="noreferrer"
                                style={{ fontSize: 12, color: '#58a6ff', lineHeight: 1.45, display: 'block', textDecoration: 'none' }}
                                onMouseEnter={e => e.target.style.textDecoration = 'underline'}
                                onMouseLeave={e => e.target.style.textDecoration = 'none'}>
                                {pTitle}
                              </a>
                            ) : (
                              <span style={{ fontSize: 12, color: '#8b949e', lineHeight: 1.45 }}>{pTitle}</span>
                            )}
                            {meta?.authors && (
                              <div style={{ fontSize: 11, color: '#6e7681', marginTop: 2 }}>
                                {(meta.authors || []).slice(0, 2).join(', ')}
                                {meta.year ? ` · ${meta.year}` : ''}
                                {meta.citations ? ` · ${meta.citations} citations` : ''}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Right sidebar: skills + resources + papers list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {r.key_skills?.length > 0 && (
              <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: 14 }}>
                <h3 style={{ fontSize: 13, marginBottom: 10, color: '#bc8cff', fontWeight: 600 }}>🎯 Key Skills</h3>
                {r.key_skills.map((s, i) => (
                  <div key={i} style={{ background: 'rgba(188,140,255,.08)', border: '1px solid rgba(188,140,255,.18)', borderRadius: 5, padding: '6px 10px', fontSize: 12, color: '#c9d1d9', marginBottom: 6, lineHeight: 1.45 }}>
                    {s}
                  </div>
                ))}
              </div>
            )}

            {r.resources?.length > 0 && (
              <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: 14 }}>
                <h3 style={{ fontSize: 13, marginBottom: 10, color: '#e3b341', fontWeight: 600 }}>📚 Resources</h3>
                {r.resources.map((res, i) => (
                  <div key={i} style={{ fontSize: 12, color: '#8b949e', padding: '5px 0', borderBottom: i < r.resources.length - 1 ? '1px solid #21262d' : 'none', lineHeight: 1.5 }}>
                    {res}
                  </div>
                ))}
              </div>
            )}

            {/* GitHub repos for this topic */}
            {result?.repos?.length > 0 && (
              <RepoList repos={result.repos} />
            )}

            {/* All fetched papers with links */}
            {result?.papers?.length > 0 && (
              <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: 14 }}>
                <h3 style={{ fontSize: 13, marginBottom: 10, color: '#8b949e', fontWeight: 600 }}>
                  📑 All Papers ({result.papers.length})
                </h3>
                {result.papers.map((p, i) => (
                  <div key={i} style={{ paddingBottom: 8, marginBottom: 8, borderBottom: i < result.papers.length - 1 ? '1px solid #21262d' : 'none' }}>
                    <a href={p.url || p.id} target="_blank" rel="noreferrer"
                      style={{ fontSize: 12, color: '#58a6ff', lineHeight: 1.4, display: 'block', textDecoration: 'none' }}
                      onMouseEnter={e => e.target.style.textDecoration = 'underline'}
                      onMouseLeave={e => e.target.style.textDecoration = 'none'}>
                      {p.title}
                    </a>
                    <div style={{ fontSize: 11, color: '#6e7681', marginTop: 2 }}>
                      {(p.authors || []).slice(0, 2).join(', ')}
                      {p.year ? ` · ${p.year}` : ''}
                      {p.citations ? ` · ${p.citations} cit.` : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  )
}
