import React, { useState, useEffect } from 'react'
import { api } from '../services/api'
import { useTopicContext } from '../App'
import Graph from '../components/Graph'
import Spinner from '../components/Spinner'

export default function Survey() {
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
    try { setResult(await api.survey(topic)) }
    catch (e) { setError(e.message) }
    setLoading(false)
  }

  function exportMd() {
    if (!result) return
    const s = result.survey || {}
    let md = `# Literature Survey: ${topic}\n\n`
    if (s.introduction) md += `## Introduction\n${s.introduction}\n\n`
    ;(s.sections || []).forEach(sec => { md += `## ${sec.heading}\n${sec.content}\n\n` })
    if (s.conclusion) md += `## Conclusion\n${s.conclusion}\n\n`
    if (s.gaps?.length) md += `## Research Gaps\n${s.gaps.map(g => `- ${g}`).join('\n')}\n`
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/plain' }))
    a.download = `survey_${topic.replace(/\W+/g, '_').substring(0, 30)}.md`; a.click()
  }

  const s = result?.survey

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: 20, flexShrink: 0 }}>
        <h2 style={{ fontSize: 16, marginBottom: 4 }}>📚 Literature Survey Generator</h2>
        <p style={{ color: '#8b949e', fontSize: 13, marginBottom: 14 }}>Structured multi-section survey with themes, trends, gaps, and conclusion</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <input value={topic} onChange={e => setTopic(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()}
            placeholder="e.g. Transformer architectures for code generation"
            style={{ flex: 1, background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, color: '#e6edf3', padding: '8px 12px', fontSize: 14, outline: 'none' }}
            onFocus={e => e.target.style.borderColor = '#58a6ff'}
            onBlur={e => e.target.style.borderColor = '#30363d'} />
          <button onClick={run} disabled={loading || !topic.trim()}
            style={{ background: loading ? '#21262d' : '#58a6ff', color: loading ? '#8b949e' : '#000', border: 'none', borderRadius: 6, padding: '8px 20px', fontWeight: 600, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
            {loading ? <><Spinner />Generating…</> : 'Generate Survey'}
          </button>
        </div>
        {error && <div style={{ marginTop: 10, color: '#f85149', fontSize: 13, background: 'rgba(248,81,73,.08)', padding: '8px 12px', borderRadius: 6 }}>⚠️ {error}</div>}
        {loading && <p style={{ color: '#8b949e', fontSize: 12, marginTop: 8 }}>Collecting papers and generating survey — ~30s…</p>}
      </div>

      {s && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, alignItems: 'start' }}>
          <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 15 }}>Survey: {topic}</h3>
              <button onClick={exportMd} style={{ background: 'none', border: '1px solid #58a6ff', color: '#58a6ff', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}>⬇ Export .md</button>
            </div>
            {s.introduction && (
              <div style={{ background: '#0d1117', borderLeft: '3px solid #58a6ff', padding: '12px 14px', borderRadius: 4, marginBottom: 18, fontSize: 13, color: '#8b949e', lineHeight: 1.75 }}>{s.introduction}</div>
            )}
            {(s.sections || []).map((sec, i) => (
              <div key={i} style={{ marginBottom: 18 }}>
                <h4 style={{ color: '#bc8cff', fontSize: 14, marginBottom: 7, fontWeight: 600 }}>{sec.heading}</h4>
                <p style={{ fontSize: 13, color: '#8b949e', lineHeight: 1.75, margin: 0 }}>{sec.content}</p>
              </div>
            ))}
            {s.conclusion && (
              <div style={{ background: '#0d1117', borderLeft: '3px solid #3fb950', padding: '12px 14px', borderRadius: 4, marginTop: 4, fontSize: 13, color: '#8b949e', lineHeight: 1.75 }}>
                <strong style={{ color: '#3fb950' }}>Conclusion: </strong>{s.conclusion}
              </div>
            )}
            {s.gaps?.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <h4 style={{ color: '#e3b341', fontSize: 14, marginBottom: 10 }}>💡 Research Gaps</h4>
                {s.gaps.map((g, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'flex-start', background: '#0d1117', padding: '8px 12px', borderRadius: 6 }}>
                    <span style={{ background: 'rgba(227,179,65,.15)', color: '#e3b341', width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
                    <span style={{ fontSize: 13, color: '#8b949e', lineHeight: 1.6 }}>{g}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {result?.graph && (
              <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: 14 }}>
                <h3 style={{ fontSize: 13, marginBottom: 10, fontWeight: 600 }}>Knowledge Graph</h3>
                <Graph data={result.graph} height={420} />
              </div>
            )}
            {result?.papers?.length > 0 && (
              <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: 14 }}>
                <h3 style={{ fontSize: 13, marginBottom: 10, color: '#8b949e' }}>Papers Analysed ({result.papers.length})</h3>
                {result.papers.map((p, i) => (
                  <div key={i} style={{ borderBottom: i < result.papers.length - 1 ? '1px solid #21262d' : 'none', paddingBottom: 8, marginBottom: 8 }}>
                    <a href={p.url || p.id} target="_blank" rel="noreferrer"
                      style={{ fontSize: 12, color: '#58a6ff', lineHeight: 1.4, display: 'block', textDecoration: 'none' }}
                      onMouseEnter={e => e.target.style.textDecoration = 'underline'}
                      onMouseLeave={e => e.target.style.textDecoration = 'none'}>
                      {p.title}
                    </a>
                    <div style={{ fontSize: 11, color: '#6e7681', marginTop: 2 }}>
                      {(p.authors || []).slice(0, 2).join(', ')}
                      {p.year ? ` · ${p.year}` : ''}
                      {p.citations ? ` · ${p.citations} citations` : ''}
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
