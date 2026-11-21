import React, { useState } from 'react'
import { api } from '../services/api'
import { useTopicField } from '../App'
import Graph from '../components/Graph'
import Spinner from '../components/Spinner'
import ErrorNote from '../components/ErrorNote'
import { DocSkeleton } from '../components/Skeleton'
import { useToast, useNotifyDone } from '../components/Toast'
import { toText, asArray } from '../utils/safe'
import Ic from '../components/Ic'

export default function Survey() {
  // follows the header topic until edited here
  const [topic, setTopic, commitTopic] = useTopicField()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [ranTopic, setRanTopic] = useState('')

  const toast = useToast()
  const notify = useNotifyDone('survey', 'Survey')

  async function run() {
    if (!topic.trim() || loading) return
    const t = topic
    commitTopic(t)
    setLoading(true); setError(''); setResult(null)
    try { setResult(await api.survey(t)); setRanTopic(t); notify(`Survey ready: ${t}`) }
    catch (e) { setError(e.message); notify(e.message, 'error') }
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
    toast({ message: `Saved ${a.download}`, kind: 'success' })
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 8, padding: 20, flexShrink: 0 }}>
        <h2 className="ri-title" style={{ fontSize: 18, marginBottom: 4 }}>Literature Survey Generator</h2>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 14 }}>Structured multi-section survey with themes, trends, gaps, and conclusion</p>
        <div className="ri-form-row" style={{ display: 'flex', gap: 10 }}>
          <input name="topic" autoComplete="off" value={topic} onChange={e => setTopic(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()}
            placeholder="e.g. Transformer architectures for code generation" aria-label="Transformer architectures for code generation"
            style={{ flex: 1, background: 'var(--panel)', border: '1px solid var(--border2)', borderRadius: 6, color: 'var(--text)', padding: '8px 12px', fontSize: 14 }}
            onFocus={e => e.target.style.borderColor = 'var(--accent)'}
            onBlur={e => e.target.style.borderColor = 'var(--border2)'} />
          <button onClick={run} disabled={loading || !topic.trim()}
            style={{ background: loading ? 'var(--border)' : 'var(--accent)', color: loading ? 'var(--muted)' : 'var(--on-accent)', border: 'none', borderRadius: 6, padding: '8px 20px', fontWeight: 600, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
            {loading ? <><Spinner />Generating…</> : 'Generate Survey'}
          </button>
        </div>
        <ErrorNote error={error} />
        {loading && <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>Collecting papers and generating survey — ~30s…</p>}
      </div>

      {loading && <DocSkeleton label="Generating survey" />}

      {s && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16, alignItems: 'start' }}>
          <div style={{ background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 15 }}>Survey: {ranTopic}</h3>
              <button onClick={exportMd} style={{ background: 'none', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}>⬇ Export .md</button>
            </div>
            {s.introduction && (
              <div style={{ background: 'var(--panel)', borderLeft: '3px solid var(--accent)', padding: '12px 14px', borderRadius: 4, marginBottom: 18, fontSize: 13, color: 'var(--muted)', lineHeight: 1.75 }}>{s.introduction}</div>
            )}
            {s.sections.map((sec, i) => (
              <div key={i} style={{ marginBottom: 18 }}>
                <h4 style={{ color: 'var(--purple)', fontSize: 14, marginBottom: 7, fontWeight: 600 }}>{sec.heading}</h4>
                <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.75, margin: 0 }}>{sec.content}</p>
              </div>
            ))}
            {s.conclusion && (
              <div style={{ background: 'var(--panel)', borderLeft: '3px solid var(--green)', padding: '12px 14px', borderRadius: 4, marginTop: 4, fontSize: 13, color: 'var(--muted)', lineHeight: 1.75 }}>
                <strong style={{ color: 'var(--green)' }}>Conclusion: </strong>{s.conclusion}
              </div>
            )}
            {s.gaps.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <h4 style={{ color: 'var(--orange)', fontSize: 14, marginBottom: 10 }}><Ic d="bulb" /> Research Gaps</h4>
                {s.gaps.map((g, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'flex-start', background: 'var(--panel)', padding: '8px 12px', borderRadius: 6 }}>
                    <span style={{ background: 'rgba(var(--ochre-rgb),.15)', color: 'var(--orange)', width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
                    <span style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>{g}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {result?.graph && (
              <div style={{ background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}>
                <h3 style={{ fontSize: 13, marginBottom: 10, fontWeight: 600 }}>Knowledge Graph</h3>
                <Graph data={result.graph} height={420} />
              </div>
            )}
            {result?.papers?.length > 0 && (
              <div style={{ background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}>
                <h3 style={{ fontSize: 13, marginBottom: 10, color: 'var(--muted)' }}>Papers Analysed ({result.papers.length})</h3>
                {result.papers.map((p, i) => (
                  <div key={i} style={{ borderBottom: i < result.papers.length - 1 ? '1px solid var(--border)' : 'none', paddingBottom: 8, marginBottom: 8 }}>
                    <a href={p.url || p.id} target="_blank" rel="noreferrer"
                      style={{ fontSize: 12, color: 'var(--accent)', lineHeight: 1.4, display: 'block', textDecoration: 'none' }}
                      onMouseEnter={e => e.target.style.textDecoration = 'underline'}
                      onMouseLeave={e => e.target.style.textDecoration = 'none'}>
                      {p.title}
                    </a>
                    <div style={{ fontSize: 11, color: 'var(--muted2)', marginTop: 2 }}>
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
