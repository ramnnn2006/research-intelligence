import React, { useState } from 'react'
import { api } from '../services/api'
import { useTopicField } from '../App'
import PaperCard from '../components/PaperCard'
import Spinner from '../components/Spinner'
import ErrorNote from '../components/ErrorNote'
import { DocSkeleton } from '../components/Skeleton'
import { useToast, useNotifyDone } from '../components/Toast'
import { toText } from '../utils/safe'

function Md({ text }) {
  if (!text) return null
  const html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h4 style="color:var(--accent);margin:12px 0 5px;font-size:14px">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 style="color:var(--accent);margin:14px 0 6px;font-size:15px">$1</h3>')
    .replace(/^- (.+)$/gm, '<li style="margin:3px 0">$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li style="margin:3px 0">$1</li>')
    .replace(/(<li[^>]*>[\s\S]*?<\/li>)+/g, s => `<ul style="padding-left:18px;margin:6px 0">${s}</ul>`)
    .replace(/\n\n/g, '</p><p style="margin:8px 0">').replace(/\n/g, '<br/>')
  return <div style={{ lineHeight: 1.8, color: 'var(--muted)', fontSize: 13 }} dangerouslySetInnerHTML={{ __html: '<p style="margin:0">' + html + '</p>' }} />
}

export default function Review() {
  // follows the header topic until edited here
  const [topic, setTopic, commitTopic] = useTopicField()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [ranTopic, setRanTopic] = useState('')

  const toast = useToast()
  const notify = useNotifyDone('review', 'Review')

  async function run() {
    if (!topic.trim() || loading) return
    const t = topic
    commitTopic(t)
    setLoading(true); setError(''); setResult(null)
    try { setResult(await api.review(t)); setRanTopic(t); notify(`Literature review ready: ${t}`) }
    catch (e) { setError(e.message); notify(e.message, 'error') }
    finally { setLoading(false) }
  }

  function exportMd() {
    if (!result) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([`# Literature Review: ${ranTopic}\n\n${result.review}`], { type: 'text/plain' }))
    a.download = `review_${ranTopic.replace(/\W+/g, '_').substring(0, 30)}.md`; a.click()
    toast({ message: `Saved ${a.download}`, kind: 'success' })
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 8, padding: 20, flexShrink: 0 }}>
        <h2 className="ri-title" style={{ fontSize: 18, marginBottom: 4 }}>Literature Review Generator</h2>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 14 }}>Formal academic literature review using top papers from ArXiv + Semantic Scholar</p>
        <div className="ri-form-row" style={{ display: 'flex', gap: 10 }}>
          <input name="topic" autoComplete="off" value={topic} onChange={e => setTopic(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()}
            placeholder="e.g. Federated Learning for privacy preservation" aria-label="Federated Learning for privacy preservation"
            style={{ flex: 1, background: 'var(--panel)', border: '1px solid var(--border2)', borderRadius: 6, color: 'var(--text)', padding: '8px 12px', fontSize: 14 }}
            onFocus={e => e.target.style.borderColor = 'var(--accent)'}
            onBlur={e => e.target.style.borderColor = 'var(--border2)'} />
          <button onClick={run} disabled={loading || !topic.trim()}
            style={{ background: loading ? 'var(--border)' : 'var(--accent)', color: loading ? 'var(--muted)' : 'var(--on-accent)', border: 'none', borderRadius: 6, padding: '8px 20px', fontWeight: 600, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap' }}>
            {loading ? <><Spinner />Generating…</> : 'Generate Review'}
          </button>
        </div>
        <ErrorNote error={error} />
        {loading && <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>Fetching papers and generating review — ~30s…</p>}
      </div>

      {loading && <DocSkeleton label="Generating literature review" />}

      {result && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 16, alignItems: 'start' }}>
          <div style={{ background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 15 }}>Review: {ranTopic}</h3>
              <button onClick={exportMd} style={{ background: 'none', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}>⬇ Export .md</button>
            </div>
            <Md text={typeof result.review === 'string' ? result.review : toText(result.review)} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--muted)' }}>Papers Used ({result.papers?.length || 0})</div>
            {(result.papers || []).map((p, i) => <PaperCard key={i} paper={p} />)}
          </div>
        </div>
      )}
    </div>
  )
}
