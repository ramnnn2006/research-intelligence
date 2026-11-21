import React, { useState } from 'react'
import { api } from '../services/api'
import { useTopicField } from '../App'
import Spinner from '../components/Spinner'
import ErrorNote from '../components/ErrorNote'
import { DocSkeleton } from '../components/Skeleton'
import { useNotifyDone } from '../components/Toast'
import { toText, asArray } from '../utils/safe'

const COLORS = ['var(--accent)', 'var(--purple)', 'var(--green)', 'var(--orange)', 'var(--red)']

export default function Gaps() {
  // follows the header topic until edited here
  const [topic, setTopic, commitTopic] = useTopicField()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [ranTopic, setRanTopic] = useState('')

  const notify = useNotifyDone('gaps', 'Gaps')

  async function run() {
    if (!topic.trim() || loading) return
    const t = topic
    commitTopic(t)
    setLoading(true); setError(''); setResult(null)
    try { setResult(await api.gaps(t)); setRanTopic(t); notify(`Research gaps ready: ${t}`) }
    catch (e) { setError(e.message); notify(e.message, 'error') }
    finally { setLoading(false) }
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 8, padding: 20, flexShrink: 0 }}>
        <h2 className="ri-title" style={{ fontSize: 18, marginBottom: 4 }}>Research Gap Detector</h2>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 14 }}>Identify unresolved problems and future research opportunities</p>
        <div className="ri-form-row" style={{ display: 'flex', gap: 10 }}>
          <input name="topic" autoComplete="off" value={topic} onChange={e => setTopic(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()}
            placeholder="e.g. explainable AI in medical imaging" aria-label="explainable AI in medical imaging"
            style={{ flex: 1, background: 'var(--panel)', border: '1px solid var(--border2)', borderRadius: 6, color: 'var(--text)', padding: '8px 12px', fontSize: 14 }}
            onFocus={e => e.target.style.borderColor = 'var(--accent)'}
            onBlur={e => e.target.style.borderColor = 'var(--border2)'} />
          <button onClick={run} disabled={loading || !topic.trim()}
            style={{ background: loading ? 'var(--border)' : 'var(--accent)', color: loading ? 'var(--muted)' : 'var(--on-accent)', border: 'none', borderRadius: 6, padding: '8px 20px', fontWeight: 600, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer' }}>
            {loading ? <><Spinner />Detecting…</> : 'Detect Gaps'}
          </button>
        </div>
        <ErrorNote error={error} />
        {loading && <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>Analysing papers to identify gaps — ~20s…</p>}
      </div>

      {loading && <DocSkeleton label="Detecting research gaps" />}

      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p style={{ fontSize: 13, color: 'var(--muted)', flexShrink: 0 }}>
            Analysed <strong style={{ color: 'var(--text)' }}>{result.papers_analysed}</strong> papers on <strong style={{ color: 'var(--accent)' }}>{ranTopic}</strong>
          </p>
          {asArray(result.gaps).map((gap, i) => (
            <div key={i} style={{ background: 'var(--panel2)', border: '1px solid var(--border)', borderLeft: `3px solid ${COLORS[i % 5]}`, borderRadius: 8, padding: '14px 16px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, background: `color-mix(in srgb, ${COLORS[i % 5]} 8%, transparent)`, color: COLORS[i % 5], display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13 }}>{i + 1}</div>
              <div style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.65 }}>{toText(gap)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
