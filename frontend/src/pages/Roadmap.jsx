import React, { useState } from 'react'
import { api } from '../services/api'
import { useTopicField } from '../App'
import Spinner from '../components/Spinner'
import ErrorNote from '../components/ErrorNote'
import { DocSkeleton } from '../components/Skeleton'
import { useNotifyDone } from '../components/Toast'
import RepoList from '../components/RepoList'
import { toText, asArray, safeHttpUrl } from '../utils/safe'

const PC = ['#1E4FA0', '#6B3FA0', '#2E7D46', '#B08A00']

export default function Roadmap() {
  // follows the header topic until edited here
  const [topic, setTopic, commitTopic] = useTopicField()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const notify = useNotifyDone('roadmap', 'Roadmap')

  async function run() {
    if (!topic.trim() || loading) return
    const t = topic
    commitTopic(t)
    setLoading(true); setError(''); setResult(null)
    try { setResult(await api.roadmap(t)); notify(`Roadmap ready: ${t}`) }
    catch (e) { setError(e.message); notify(e.message, 'error') }
    finally { setLoading(false) }
  }

  // LLM output: normalise every field to text / arrays before rendering
  const rawRoadmap = result?.roadmap
  const r = rawRoadmap && typeof rawRoadmap === 'object' && !Array.isArray(rawRoadmap) ? {
    overview: toText(rawRoadmap.overview),
    phases: asArray(rawRoadmap.phases).map(ph => ({
      phase: toText(ph?.phase),
      duration: toText(ph?.duration),
      tasks: asArray(ph?.tasks).map(toText).filter(Boolean),
      papers: asArray(ph?.papers),
    })),
    key_skills: asArray(rawRoadmap.key_skills).map(toText).filter(Boolean),
    resources: asArray(rawRoadmap.resources).map(toText).filter(Boolean),
  } : null
  // Build a title→paper lookup so phase papers get clickable links
  const paperIndex = {}
  ;(result?.papers || []).forEach(p => {
    const key = (p.title || '').toLowerCase().substring(0, 50)
    if (key) paperIndex[key] = p
  })

  function findPaper(title) {
    const key = (title || '').toLowerCase().substring(0, 50)
    if (!key) return null
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
      <div style={{ background: '#FAF6EC', border: '1px solid #E6E0D0', borderRadius: 8, padding: 20, flexShrink: 0 }}>
        <h2 className="ri-title" style={{ fontSize: 18, marginBottom: 4 }}>Research Roadmap Generator</h2>
        <p style={{ color: '#6E6858', fontSize: 13, marginBottom: 14 }}>
          Structured learning plan with phases, tasks, key papers, and skills
        </p>
        <div className="ri-form-row" style={{ display: 'flex', gap: 10 }}>
          <input
            value={topic} onChange={e => setTopic(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && run()}
            placeholder="e.g. multimodal learning for robotics" aria-label="multimodal learning for robotics"
            style={{ flex: 1, background: '#FFFFFF', border: '1px solid #D9D2BE', borderRadius: 6, color: '#2B3A55', padding: '8px 12px', fontSize: 14, outline: 'none' }}
            onFocus={e => e.target.style.borderColor = '#1E4FA0'}
            onBlur={e => e.target.style.borderColor = '#D9D2BE'}
          />
          <button onClick={run} disabled={loading || !topic.trim()}
            style={{ background: loading ? '#E6E0D0' : '#1E4FA0', color: loading ? '#6E6858' : '#FFFFFF', border: 'none', borderRadius: 6, padding: '8px 20px', fontWeight: 600, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer' }}>
            {loading ? <><Spinner />Building…</> : 'Build Roadmap'}
          </button>
        </div>
        <ErrorNote error={error} />
        {loading && <p style={{ color: '#6E6858', fontSize: 12, marginTop: 8 }}>Fetching papers and building roadmap — ~20s…</p>}
      </div>

      {loading && <DocSkeleton label="Building roadmap" />}

      {r && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 16, alignItems: 'start' }}>

          {/* Phases */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {r.overview && (
              <div style={{ background: '#FAF6EC', border: '1px solid #E6E0D0', borderLeft: '3px solid #1E4FA0', borderRadius: 8, padding: '14px 16px', fontSize: 13, color: '#6E6858', lineHeight: 1.7 }}>
                {r.overview}
              </div>
            )}

            {r.phases.map((phase, i) => (
              <div key={i} style={{ background: '#FAF6EC', border: '1px solid #E6E0D0', borderLeft: `3px solid ${PC[i % 4]}`, borderRadius: 8, padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                  <span style={{ background: `${PC[i % 4]}18`, color: PC[i % 4], padding: '3px 10px', borderRadius: 99, fontSize: 12, fontWeight: 700 }}>
                    Phase {i + 1}
                  </span>
                  <span style={{ fontWeight: 600, fontSize: 14, color: '#2B3A55' }}>
                    {phase.phase.replace(/^Phase \d+[:\-\s]*/i, '')}
                  </span>
                  {phase.duration && (
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#6E6858', background: '#FFFFFF', padding: '2px 8px', borderRadius: 4 }}>
                      ⏱ {phase.duration}
                    </span>
                  )}
                </div>

                {/* Tasks */}
                {phase.tasks.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, color: '#8A8375', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Tasks</div>
                    {phase.tasks.map((t, j) => (
                      <div key={j} style={{ display: 'flex', gap: 8, fontSize: 13, color: '#44516E', marginBottom: 6, lineHeight: 1.55 }}>
                        <span style={{ color: PC[i % 4], flexShrink: 0, marginTop: 1 }}>▸</span>
                        {t}
                      </div>
                    ))}
                  </div>
                )}

                {/* Key Papers — with direct URLs from LLM */}
                {phase.papers.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11, color: '#8A8375', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>Key Papers</div>
                    {phase.papers.map((p, j) => {
                      // LLM now returns {title, url} objects; fallback to string + fuzzy match
                      const isObj  = p && typeof p === 'object'
                      const pTitle = isObj ? toText(p.title) : toText(p)
                      // only http(s) links, the URL is written by the LLM
                      const pUrl   = isObj ? safeHttpUrl(p.url) : null
                      const matched = pUrl ? null : findPaper(pTitle)
                      const url = pUrl || (matched ? safeHttpUrl(matched.url || matched.id) : null)
                      const meta = matched || (isObj ? p : null)
                      return (
                        <div key={j} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0', borderBottom: j < phase.papers.length - 1 ? '1px solid #E6E0D0' : 'none' }}>
                          <span style={{ color: '#B08A00', flexShrink: 0 }}>📄</span>
                          <div style={{ flex: 1 }}>
                            {url ? (
                              <a href={url} target="_blank" rel="noreferrer"
                                style={{ fontSize: 12, color: '#1E4FA0', lineHeight: 1.45, display: 'block', textDecoration: 'none' }}
                                onMouseEnter={e => e.target.style.textDecoration = 'underline'}
                                onMouseLeave={e => e.target.style.textDecoration = 'none'}>
                                {pTitle}
                              </a>
                            ) : (
                              <span style={{ fontSize: 12, color: '#6E6858', lineHeight: 1.45 }}>{pTitle}</span>
                            )}
                            {Array.isArray(meta?.authors) && (
                              <div style={{ fontSize: 11, color: '#8A8375', marginTop: 2 }}>
                                {meta.authors.slice(0, 2).map(toText).join(', ')}
                                {meta.year ? ` · ${toText(meta.year)}` : ''}
                                {meta.citations ? ` · ${toText(meta.citations)} citations` : ''}
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
            {r.key_skills.length > 0 && (
              <div style={{ background: '#FAF6EC', border: '1px solid #E6E0D0', borderRadius: 8, padding: 14 }}>
                <h3 style={{ fontSize: 13, marginBottom: 10, color: '#6B3FA0', fontWeight: 600 }}>🎯 Key Skills</h3>
                {r.key_skills.map((s, i) => (
                  <div key={i} style={{ background: 'rgba(188,140,255,.08)', border: '1px solid rgba(188,140,255,.18)', borderRadius: 5, padding: '6px 10px', fontSize: 12, color: '#44516E', marginBottom: 6, lineHeight: 1.45 }}>
                    {s}
                  </div>
                ))}
              </div>
            )}

            {r.resources.length > 0 && (
              <div style={{ background: '#FAF6EC', border: '1px solid #E6E0D0', borderRadius: 8, padding: 14 }}>
                <h3 style={{ fontSize: 13, marginBottom: 10, color: '#B08A00', fontWeight: 600 }}>📚 Resources</h3>
                {r.resources.map((res, i) => (
                  <div key={i} style={{ fontSize: 12, color: '#6E6858', padding: '5px 0', borderBottom: i < r.resources.length - 1 ? '1px solid #E6E0D0' : 'none', lineHeight: 1.5 }}>
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
              <div style={{ background: '#FAF6EC', border: '1px solid #E6E0D0', borderRadius: 8, padding: 14 }}>
                <h3 style={{ fontSize: 13, marginBottom: 10, color: '#6E6858', fontWeight: 600 }}>
                  📑 All Papers ({result.papers.length})
                </h3>
                {result.papers.map((p, i) => (
                  <div key={i} style={{ paddingBottom: 8, marginBottom: 8, borderBottom: i < result.papers.length - 1 ? '1px solid #E6E0D0' : 'none' }}>
                    <a href={safeHttpUrl(p.url || p.id) || undefined} target="_blank" rel="noreferrer"
                      style={{ fontSize: 12, color: '#1E4FA0', lineHeight: 1.4, display: 'block', textDecoration: 'none' }}
                      onMouseEnter={e => e.target.style.textDecoration = 'underline'}
                      onMouseLeave={e => e.target.style.textDecoration = 'none'}>
                      {p.title}
                    </a>
                    <div style={{ fontSize: 11, color: '#8A8375', marginTop: 2 }}>
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
