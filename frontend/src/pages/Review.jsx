import React, { useState } from 'react'
import { api } from '../services/api'
import { useTopicField } from '../App'
import PaperCard from '../components/PaperCard'
import Spinner from '../components/Spinner'
import { toText } from '../utils/safe'

function Md({ text }) {
  if (!text) return null
  const html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h4 style="color:#1E4FA0;margin:12px 0 5px;font-size:14px">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 style="color:#1E4FA0;margin:14px 0 6px;font-size:15px">$1</h3>')
    .replace(/^- (.+)$/gm, '<li style="margin:3px 0">$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li style="margin:3px 0">$1</li>')
    .replace(/(<li[^>]*>[\s\S]*?<\/li>)+/g, s => `<ul style="padding-left:18px;margin:6px 0">${s}</ul>`)
    .replace(/\n\n/g, '</p><p style="margin:8px 0">').replace(/\n/g, '<br/>')
  return <div style={{ lineHeight: 1.8, color: '#6E6858', fontSize: 13 }} dangerouslySetInnerHTML={{ __html: '<p style="margin:0">' + html + '</p>' }} />
}

export default function Review() {
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
    try { setResult(await api.review(t)); setRanTopic(t) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  function exportMd() {
    if (!result) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([`# Literature Review: ${ranTopic}\n\n${result.review}`], { type: 'text/plain' }))
    a.download = `review_${ranTopic.replace(/\W+/g, '_').substring(0, 30)}.md`; a.click()
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: '#FAF6EC', border: '1px solid #E6E0D0', borderRadius: 8, padding: 20, flexShrink: 0 }}>
        <h2 className="ri-title" style={{ fontSize: 18, marginBottom: 4 }}>Literature Review Generator</h2>
        <p style={{ color: '#6E6858', fontSize: 13, marginBottom: 14 }}>Formal academic literature review using top papers from ArXiv + Semantic Scholar</p>
        <div className="ri-form-row" style={{ display: 'flex', gap: 10 }}>
          <input value={topic} onChange={e => setTopic(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()}
            placeholder="e.g. Federated Learning for privacy preservation"
            style={{ flex: 1, background: '#FFFFFF', border: '1px solid #D9D2BE', borderRadius: 6, color: '#2B3A55', padding: '8px 12px', fontSize: 14, outline: 'none' }}
            onFocus={e => e.target.style.borderColor = '#1E4FA0'}
            onBlur={e => e.target.style.borderColor = '#D9D2BE'} />
          <button onClick={run} disabled={loading || !topic.trim()}
            style={{ background: loading ? '#E6E0D0' : '#1E4FA0', color: loading ? '#6E6858' : '#FFFFFF', border: 'none', borderRadius: 6, padding: '8px 20px', fontWeight: 600, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
            {loading ? <><Spinner />Generating…</> : 'Generate Review'}
          </button>
        </div>
        {error && <div style={{ marginTop: 10, color: '#C13B2E', fontSize: 13, background: 'rgba(193,59,46,.08)', padding: '8px 12px', borderRadius: 6 }}>⚠️ {error}</div>}
        {loading && <p style={{ color: '#6E6858', fontSize: 12, marginTop: 8 }}>Fetching papers and generating review — ~30s…</p>}
      </div>

      {result && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16, alignItems: 'start' }}>
          <div style={{ background: '#FAF6EC', border: '1px solid #E6E0D0', borderRadius: 8, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 15 }}>Review: {ranTopic}</h3>
              <button onClick={exportMd} style={{ background: 'none', border: '1px solid #1E4FA0', color: '#1E4FA0', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}>⬇ Export .md</button>
            </div>
            <Md text={typeof result.review === 'string' ? result.review : toText(result.review)} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#6E6858' }}>Papers Used ({result.papers?.length || 0})</div>
            {(result.papers || []).map((p, i) => <PaperCard key={i} paper={p} />)}
          </div>
        </div>
      )}
    </div>
  )
}
