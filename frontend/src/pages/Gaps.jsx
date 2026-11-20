import React, { useState } from 'react'
import { api } from '../services/api'
import { useTopicField } from '../App'
import Spinner from '../components/Spinner'
import { toText, asArray } from '../utils/safe'

const COLORS = ['#1E4FA0', '#6B3FA0', '#2E7D46', '#B08A00', '#C13B2E']

export default function Gaps() {
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
    try { setResult(await api.gaps(t)); setRanTopic(t) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: '#FAF6EC', border: '1px solid #E6E0D0', borderRadius: 8, padding: 20, flexShrink: 0 }}>
        <h2 className="ri-title" style={{ fontSize: 18, marginBottom: 4 }}>Research Gap Detector</h2>
        <p style={{ color: '#6E6858', fontSize: 13, marginBottom: 14 }}>Identify unresolved problems and future research opportunities</p>
        <div className="ri-form-row" style={{ display: 'flex', gap: 10 }}>
          <input value={topic} onChange={e => setTopic(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()}
            placeholder="e.g. explainable AI in medical imaging"
            style={{ flex: 1, background: '#FFFFFF', border: '1px solid #D9D2BE', borderRadius: 6, color: '#2B3A55', padding: '8px 12px', fontSize: 14, outline: 'none' }}
            onFocus={e => e.target.style.borderColor = '#1E4FA0'}
            onBlur={e => e.target.style.borderColor = '#D9D2BE'} />
          <button onClick={run} disabled={loading || !topic.trim()}
            style={{ background: loading ? '#E6E0D0' : '#1E4FA0', color: loading ? '#6E6858' : '#FFFFFF', border: 'none', borderRadius: 6, padding: '8px 20px', fontWeight: 600, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer' }}>
            {loading ? <><Spinner />Detecting…</> : 'Detect Gaps'}
          </button>
        </div>
        {error && <div style={{ marginTop: 10, color: '#C13B2E', fontSize: 13, background: 'rgba(193,59,46,.08)', padding: '8px 12px', borderRadius: 6 }}>⚠️ {error}</div>}
        {loading && <p style={{ color: '#6E6858', fontSize: 12, marginTop: 8 }}>Analysing papers to identify gaps — ~20s…</p>}
      </div>

      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ fontSize: 13, color: '#6E6858', flexShrink: 0 }}>
            Analysed <strong style={{ color: '#2B3A55' }}>{result.papers_analysed}</strong> papers on <strong style={{ color: '#1E4FA0' }}>{ranTopic}</strong>
          </p>
          {asArray(result.gaps).map((gap, i) => (
            <div key={i} style={{ background: '#FAF6EC', border: '1px solid #E6E0D0', borderLeft: `3px solid ${COLORS[i % 5]}`, borderRadius: 8, padding: '14px 16px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, background: `${COLORS[i % 5]}15`, color: COLORS[i % 5], display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13 }}>{i + 1}</div>
              <div style={{ fontSize: 14, color: '#2B3A55', lineHeight: 1.65 }}>{toText(gap)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
