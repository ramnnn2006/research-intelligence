import React, { useState } from 'react'
import { api } from '../services/api'
import Spinner from '../components/Spinner'
import ErrorNote from '../components/ErrorNote'
import { DocSkeleton } from '../components/Skeleton'
import { useNotifyDone } from '../components/Toast'
import { toText, asArray } from '../utils/safe'

function PaperInput({ label, value, onChange, onSubmit }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 12, color: '#6E6858', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>
        {label}
      </div>
      <input
        value={value.title || ''}
        onChange={e => onChange({ ...value, title: e.target.value })}
        placeholder="Paper title" aria-label={label + " title"}
        onKeyDown={e => { if (e.key === 'Enter' && onSubmit) onSubmit() }}
        style={{ width: '100%', background: '#FFFFFF', border: '1px solid #D9D2BE', borderRadius: 6, color: '#2B3A55', padding: '8px 10px', fontSize: 13, outline: 'none', marginBottom: 8, boxSizing: 'border-box' }}
        onFocus={e => e.target.style.borderColor = '#1E4FA0'}
        onBlur={e => e.target.style.borderColor = '#D9D2BE'}
      />
      <textarea
        value={value.summary || ''}
        onChange={e => onChange({ ...value, summary: e.target.value })}
        placeholder="Paste abstract here (optional — improves comparison accuracy)" aria-label={label + " abstract (optional)"}
        rows={5}
        style={{ width: '100%', background: '#FFFFFF', border: '1px solid #D9D2BE', borderRadius: 6, color: '#2B3A55', padding: '8px 10px', fontSize: 12, outline: 'none', resize: 'vertical', lineHeight: 1.55, boxSizing: 'border-box' }}
        onFocus={e => e.target.style.borderColor = '#1E4FA0'}
        onBlur={e => e.target.style.borderColor = '#D9D2BE'}
      />
    </div>
  )
}

export default function Compare() {
  const [pa, setPa] = useState({ title: '', summary: '' })
  const [pb, setPb] = useState({ title: '', summary: '' })
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const [titles, setTitles] = useState({ a: '', b: '' })

  const notify = useNotifyDone('compare', 'Compare')

  async function run() {
    if (!pa.title.trim() || !pb.title.trim() || loading) return
    setLoading(true); setError(''); setResult(null)
    try {
      const data = await api.compare(pa, pb)
      // LLM output: normalise to text so unexpected shapes cannot break rendering
      setResult({
        summary: toText(data?.summary),
        winner: toText(data?.winner),
        reason: toText(data?.reason),
        table: asArray(data?.table).map(row => ({
          aspect: toText(row?.aspect), paper_a: toText(row?.paper_a), paper_b: toText(row?.paper_b),
        })),
      })
      setTitles({ a: pa.title, b: pb.title })
      notify('Paper comparison ready')
    }
    catch (e) { setError(e.message); notify(e.message, 'error') }
    finally { setLoading(false) }
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Input */}
      <div style={{ background: '#FAF6EC', border: '1px solid #E6E0D0', borderRadius: 8, padding: 20, flexShrink: 0 }}>
        <h2 className="ri-title" style={{ fontSize: 18, marginBottom: 4 }}>Paper Comparison</h2>
        <p style={{ color: '#6E6858', fontSize: 13, marginBottom: 16 }}>
          Compare two papers side-by-side across methodology, datasets, results, limitations, and novelty
        </p>
        <div className="ri-compare-row" style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
          <PaperInput label="Paper A" value={pa} onChange={setPa} onSubmit={run} />
          <PaperInput label="Paper B" value={pb} onChange={setPb} onSubmit={run} />
        </div>
        <button
          onClick={run}
          disabled={loading || !pa.title.trim() || !pb.title.trim()}
          style={{ background: loading ? '#E6E0D0' : '#1E4FA0', color: loading ? '#6E6858' : '#FFFFFF', border: 'none', borderRadius: 6, padding: '8px 24px', fontWeight: 600, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer' }}
        >
          {loading ? <><Spinner />Comparing…</> : 'Compare Papers'}
        </button>
        <ErrorNote error={error} />
        {loading && <p style={{ color: '#6E6858', fontSize: 12, marginTop: 8 }}>Analysing both papers — ~20s…</p>}
      </div>

      {loading && <DocSkeleton label="Comparing papers" />}

      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Summary + winner */}
          <div style={{ background: '#FAF6EC', border: '1px solid #E6E0D0', borderRadius: 8, padding: 16 }}>
            <p style={{ fontSize: 13, color: '#44516E', lineHeight: 1.75, marginBottom: 12 }}>{result.summary}</p>
            {result.winner && result.winner !== 'N/A' && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(46,125,70,.08)', border: '1px solid rgba(46,125,70,.25)', borderRadius: 6, padding: '7px 14px' }}>
                <span style={{ fontSize: 12, color: '#6E6858' }}>Stronger overall:</span>
                <strong style={{ color: '#2E7D46', fontSize: 14 }}>{result.winner}</strong>
                {result.reason && <span style={{ fontSize: 12, color: '#6E6858' }}>— {result.reason}</span>}
              </div>
            )}
          </div>

          {/* Comparison table */}
          {result.table?.length > 0 && (
            <div style={{ background: '#FAF6EC', border: '1px solid #E6E0D0', borderRadius: 8, padding: 16, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid #E6E0D0', color: '#8A8375', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', width: 130 }}>
                      Aspect
                    </th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid #E6E0D0', color: '#1E4FA0', fontSize: 12 }}>
                      {titles.a.length > 40 ? titles.a.substring(0, 38) + '…' : titles.a}
                    </th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid #E6E0D0', color: '#6B3FA0', fontSize: 12 }}>
                      {titles.b.length > 40 ? titles.b.substring(0, 38) + '…' : titles.b}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.table.map((row, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : '#FFFFFF' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600, color: '#6E6858', borderBottom: '1px solid #E6E0D0', whiteSpace: 'nowrap', fontSize: 12 }}>
                        {row.aspect}
                      </td>
                      <td style={{ padding: '10px 12px', color: '#44516E', borderBottom: '1px solid #E6E0D0', lineHeight: 1.55, verticalAlign: 'top' }}>
                        {row.paper_a}
                      </td>
                      <td style={{ padding: '10px 12px', color: '#44516E', borderBottom: '1px solid #E6E0D0', lineHeight: 1.55, verticalAlign: 'top' }}>
                        {row.paper_b}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
