import React, { useState } from 'react'
import { api } from '../services/api'
import { useTopicField } from '../App'
import Graph from '../components/Graph'
import Spinner from '../components/Spinner'
import { toText, asArray } from '../utils/safe'

export default function Survey() {
  // follows the header topic until edited here
  const [topic, setTopic, commitTopic] = useTopicField()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [ranTopic, setRanTopic] = useState('')

  async function run() {
    if (!topic.trim() || loading) return
    const t = topic
    commitTopic(t)
    setLoading(true); setError(''); setResult(null)
    try { setResult(await api.survey(t)); setRanTopic(t) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  // LLM output: make sure every field is plain text before rendering
  const raw = result?.survey
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? {
    introduction: toText(raw.introduction),
    sections: asArray(raw.sections).map(sec => ({ heading: toText(sec?.heading), content: typeof sec === 'string' ? sec : toText(sec?.content) })),
    conclusion: toText(raw.conclusion),
    gaps: asArray(raw.gaps).map(toText).filter(Boolean),
  } : null

  function exportMd() {
    if (!s) return
    let md = `# Literature Survey: ${ranTopic}\n\n`
    if (s.introduction) md += `## Introduction\n${s.introduction}\n\n`
    s.sections.forEach(sec => { md += `## ${sec.heading}\n${sec.content}\n\n` })
    if (s.conclusion) md += `## Conclusion\n${s.conclusion}\n\n`
    if (s.gaps.length) md += `## Research Gaps\n${s.gaps.map(g => `- ${g}`).join('\n')}\n`
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/plain' }))
    a.download = `survey_${ranTopic.replace(/\W+/g, '_').substring(0, 30)}.md`; a.click()
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: '#FAF6EC', border: '1px solid #E6E0D0', borderRadius: 8, padding: 20, flexShrink: 0 }}>
        <h2 className="ri-title" style={{ fontSize: 18, marginBottom: 4 }}>Literature Survey Generator</h2>
        <p style={{ color: '#6E6858', fontSize: 13, marginBottom: 14 }}>Structured multi-section survey with themes, trends, gaps, and conclusion</p>
        <div className="ri-form-row" style={{ display: 'flex', gap: 10 }}>
          <input value={topic} onChange={e => setTopic(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()}
            placeholder="e.g. Transformer architectures for code generation"
            style={{ flex: 1, background: '#FFFFFF', border: '1px solid #D9D2BE', borderRadius: 6, color: '#2B3A55', padding: '8px 12px', fontSize: 14, outline: 'none' }}
            onFocus={e => e.target.style.borderColor = '#1E4FA0'}
            onBlur={e => e.target.style.borderColor = '#D9D2BE'} />
          <button onClick={run} disabled={loading || !topic.trim()}
            style={{ background: loading ? '#E6E0D0' : '#1E4FA0', color: loading ? '#6E6858' : '#FFFFFF', border: 'none', borderRadius: 6, padding: '8px 20px', fontWeight: 600, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
            {loading ? <><Spinner />Generating…</> : 'Generate Survey'}
          </button>
        </div>
        {error && <div style={{ marginTop: 10, color: '#C13B2E', fontSize: 13, background: 'rgba(193,59,46,.08)', padding: '8px 12px', borderRadius: 6 }}>⚠️ {error}</div>}
        {loading && <p style={{ color: '#6E6858', fontSize: 12, marginTop: 8 }}>Collecting papers and generating survey — ~30s…</p>}
      </div>

      {s && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, alignItems: 'start' }}>
          <div style={{ background: '#FAF6EC', border: '1px solid #E6E0D0', borderRadius: 8, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 15 }}>Survey: {ranTopic}</h3>
              <button onClick={exportMd} style={{ background: 'none', border: '1px solid #1E4FA0', color: '#1E4FA0', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}>⬇ Export .md</button>
            </div>
            {s.introduction && (
              <div style={{ background: '#FFFFFF', borderLeft: '3px solid #1E4FA0', padding: '12px 14px', borderRadius: 4, marginBottom: 18, fontSize: 13, color: '#6E6858', lineHeight: 1.75 }}>{s.introduction}</div>
            )}
            {s.sections.map((sec, i) => (
              <div key={i} style={{ marginBottom: 18 }}>
                <h4 style={{ color: '#6B3FA0', fontSize: 14, marginBottom: 7, fontWeight: 600 }}>{sec.heading}</h4>
                <p style={{ fontSize: 13, color: '#6E6858', lineHeight: 1.75, margin: 0 }}>{sec.content}</p>
              </div>
            ))}
            {s.conclusion && (
              <div style={{ background: '#FFFFFF', borderLeft: '3px solid #2E7D46', padding: '12px 14px', borderRadius: 4, marginTop: 4, fontSize: 13, color: '#6E6858', lineHeight: 1.75 }}>
                <strong style={{ color: '#2E7D46' }}>Conclusion: </strong>{s.conclusion}
              </div>
            )}
            {s.gaps.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <h4 style={{ color: '#B08A00', fontSize: 14, marginBottom: 10 }}>💡 Research Gaps</h4>
                {s.gaps.map((g, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'flex-start', background: '#FFFFFF', padding: '8px 12px', borderRadius: 6 }}>
                    <span style={{ background: 'rgba(176,138,0,.15)', color: '#B08A00', width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
                    <span style={{ fontSize: 13, color: '#6E6858', lineHeight: 1.6 }}>{g}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {result?.graph && (
              <div style={{ background: '#FAF6EC', border: '1px solid #E6E0D0', borderRadius: 8, padding: 14 }}>
                <h3 style={{ fontSize: 13, marginBottom: 10, fontWeight: 600 }}>Knowledge Graph</h3>
                <Graph data={result.graph} height={420} />
              </div>
            )}
            {result?.papers?.length > 0 && (
              <div style={{ background: '#FAF6EC', border: '1px solid #E6E0D0', borderRadius: 8, padding: 14 }}>
                <h3 style={{ fontSize: 13, marginBottom: 10, color: '#6E6858' }}>Papers Analysed ({result.papers.length})</h3>
                {result.papers.map((p, i) => (
                  <div key={i} style={{ borderBottom: i < result.papers.length - 1 ? '1px solid #E6E0D0' : 'none', paddingBottom: 8, marginBottom: 8 }}>
                    <a href={p.url || p.id} target="_blank" rel="noreferrer"
                      style={{ fontSize: 12, color: '#1E4FA0', lineHeight: 1.4, display: 'block', textDecoration: 'none' }}
                      onMouseEnter={e => e.target.style.textDecoration = 'underline'}
                      onMouseLeave={e => e.target.style.textDecoration = 'none'}>
                      {p.title}
                    </a>
                    <div style={{ fontSize: 11, color: '#8A8375', marginTop: 2 }}>
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
