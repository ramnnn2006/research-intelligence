import React, { useState, useEffect } from 'react'
import { api } from '../services/api'
import { useTopicContext } from '../App'
import Spinner from '../components/Spinner'

const COLORS = ['#58a6ff', '#bc8cff', '#3fb950', '#e3b341', '#f85149']

export default function Gaps() {
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
    try { setResult(await api.gaps(topic)) }
    catch (e) { setError(e.message) }
    setLoading(false)
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: 20, flexShrink: 0 }}>
        <h2 style={{ fontSize: 16, marginBottom: 4 }}>💡 Research Gap Detector</h2>
        <p style={{ color: '#8b949e', fontSize: 13, marginBottom: 14 }}>Identify unresolved problems and future research opportunities</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <input value={topic} onChange={e => setTopic(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()}
            placeholder="e.g. explainable AI in medical imaging"
            style={{ flex: 1, background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, color: '#e6edf3', padding: '8px 12px', fontSize: 14, outline: 'none' }}
            onFocus={e => e.target.style.borderColor = '#58a6ff'}
            onBlur={e => e.target.style.borderColor = '#30363d'} />
          <button onClick={run} disabled={loading || !topic.trim()}
            style={{ background: loading ? '#21262d' : '#58a6ff', color: loading ? '#8b949e' : '#000', border: 'none', borderRadius: 6, padding: '8px 20px', fontWeight: 600, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer' }}>
            {loading ? <><Spinner />Detecting…</> : 'Detect Gaps'}
          </button>
        </div>
        {error && <div style={{ marginTop: 10, color: '#f85149', fontSize: 13, background: 'rgba(248,81,73,.08)', padding: '8px 12px', borderRadius: 6 }}>⚠️ {error}</div>}
        {loading && <p style={{ color: '#8b949e', fontSize: 12, marginTop: 8 }}>Analysing papers to identify gaps — ~20s…</p>}
      </div>

      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ fontSize: 13, color: '#8b949e', flexShrink: 0 }}>
            Analysed <strong style={{ color: '#e6edf3' }}>{result.papers_analysed}</strong> papers on <strong style={{ color: '#58a6ff' }}>{topic}</strong>
          </p>
          {(result.gaps || []).map((gap, i) => (
            <div key={i} style={{ background: '#161b22', border: '1px solid #21262d', borderLeft: `3px solid ${COLORS[i % 5]}`, borderRadius: 8, padding: '14px 16px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, background: `${COLORS[i % 5]}15`, color: COLORS[i % 5], display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13 }}>{i + 1}</div>
              <div style={{ fontSize: 14, color: '#e6edf3', lineHeight: 1.65 }}>{gap}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
