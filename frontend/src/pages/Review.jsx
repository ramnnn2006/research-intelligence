import React, { useState, useEffect } from 'react'
import { api } from '../services/api'
import { useTopicContext } from '../App'
import PaperCard from '../components/PaperCard'
import Spinner from '../components/Spinner'

function Md({ text }) {
  if (!text) return null
  const html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h4 style="color:#58a6ff;margin:12px 0 5px;font-size:14px">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 style="color:#58a6ff;margin:14px 0 6px;font-size:15px">$1</h3>')
    .replace(/^- (.+)$/gm, '<li style="margin:3px 0">$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li style="margin:3px 0">$1</li>')
    .replace(/(<li[^>]*>[\s\S]*?<\/li>)+/g, s => `<ul style="padding-left:18px;margin:6px 0">${s}</ul>`)
    .replace(/\n\n/g, '</p><p style="margin:8px 0">').replace(/\n/g, '<br/>')
  return <div style={{ lineHeight: 1.8, color: '#8b949e', fontSize: 13 }} dangerouslySetInnerHTML={{ __html: '<p style="margin:0">' + html + '</p>' }} />
}

export default function Review() {
  const { topic: globalTopic, setTopic: setGlobalTopic } = useTopicContext()
  const [topic, setTopic] = useState(globalTopic || '')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  // Sync when global topic changes from header
  useEffect(() => { if (globalTopic && !topic) setTopic(globalTopic) }, [globalTopic])

  async function run() {
    if (!topic.trim() || loading) return
    setGlobalTopic(topic)
    setLoading(true); setError(''); setResult(null)
    try { setResult(await api.review(topic)) }
    catch (e) { setError(e.message) }
    setLoading(false)
  }

  function exportMd() {
    if (!result) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([`# Literature Review: ${topic}\n\n${result.review}`], { type: 'text/plain' }))
    a.download = `review_${topic.replace(/\W+/g, '_').substring(0, 30)}.md`; a.click()
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: 20, flexShrink: 0 }}>
        <h2 style={{ fontSize: 16, marginBottom: 4 }}>📖 Literature Review Generator</h2>
        <p style={{ color: '#8b949e', fontSize: 13, marginBottom: 14 }}>Formal academic literature review using top papers from ArXiv + Semantic Scholar</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <input value={topic} onChange={e => setTopic(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()}
            placeholder="e.g. Federated Learning for privacy preservation"
            style={{ flex: 1, background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, color: '#e6edf3', padding: '8px 12px', fontSize: 14, outline: 'none' }}
            onFocus={e => e.target.style.borderColor = '#58a6ff'}
            onBlur={e => e.target.style.borderColor = '#30363d'} />
          <button onClick={run} disabled={loading || !topic.trim()}
            style={{ background: loading ? '#21262d' : '#58a6ff', color: loading ? '#8b949e' : '#000', border: 'none', borderRadius: 6, padding: '8px 20px', fontWeight: 600, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
            {loading ? <><Spinner />Generating…</> : 'Generate Review'}
          </button>
        </div>
        {error && <div style={{ marginTop: 10, color: '#f85149', fontSize: 13, background: 'rgba(248,81,73,.08)', padding: '8px 12px', borderRadius: 6 }}>⚠️ {error}</div>}
        {loading && <p style={{ color: '#8b949e', fontSize: 12, marginTop: 8 }}>Fetching papers and generating review — ~30s…</p>}
      </div>

      {result && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16, alignItems: 'start' }}>
          <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 15 }}>Review: {topic}</h3>
              <button onClick={exportMd} style={{ background: 'none', border: '1px solid #58a6ff', color: '#58a6ff', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}>⬇ Export .md</button>
            </div>
            <Md text={result.review} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#8b949e' }}>Papers Used ({result.papers?.length || 0})</div>
            {(result.papers || []).map((p, i) => <PaperCard key={i} paper={p} />)}
          </div>
        </div>
      )}
    </div>
  )
}
