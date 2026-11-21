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
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>
        {label}
      </div>
      <input name="paper-title" autoComplete="off"
        value={value.title || ''}
        onChange={e => onChange({ ...value, title: e.target.value })}
        placeholder="Paper title" aria-label={label + " title"}
        onKeyDown={e => { if (e.key === 'Enter' && onSubmit) onSubmit() }}
        style={{ width: '100%', background: 'var(--panel)', border: '1px solid var(--border2)', borderRadius: 6, color: 'var(--text)', padding: '8px 10px', fontSize: 13, marginBottom: 8, boxSizing: 'border-box' }}
        onFocus={e => e.target.style.borderColor = 'var(--accent)'}
        onBlur={e => e.target.style.borderColor = 'var(--border2)'}
      />
      <textarea name="paper-abstract" autoComplete="off"
        value={value.summary || ''}
        onChange={e => onChange({ ...value, summary: e.target.value })}
        placeholder="Paste abstract here (optional — improves comparison accuracy)" aria-label={label + " abstract (optional)"}
        rows={5}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onSubmit) onSubmit() }}
        style={{ width: '100%', background: 'var(--panel)', border: '1px solid var(--border2)', borderRadius: 6, color: 'var(--text)', padding: '8px 10px', fontSize: 12, resize: 'vertical', lineHeight: 1.55, boxSizing: 'border-box' }}
        onFocus={e => e.target.style.borderColor = 'var(--accent)'}
        onBlur={e => e.target.style.borderColor = 'var(--border2)'}
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
      <div style={{ background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 8, padding: 20, flexShrink: 0 }}>
        <h2 className="ri-title" style={{ fontSize: 18, marginBottom: 4 }}>Paper Comparison</h2>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>
          Compare two papers side-by-side across methodology, datasets, results, limitations, and novelty
        </p>
        <div className="ri-compare-row" style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
          <PaperInput label="Paper A" value={pa} onChange={setPa} onSubmit={run} />
          <PaperInput label="Paper B" value={pb} onChange={setPb} onSubmit={run} />
        </div>
        <button
          onClick={run}
          disabled={loading || !pa.title.trim() || !pb.title.trim()}
          style={{ background: loading ? 'var(--border)' : 'var(--accent)', color: loading ? 'var(--muted)' : 'var(--on-accent)', border: 'none', borderRadius: 6, padding: '8px 24px', fontWeight: 600, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer' }}
        >
          {loading ? <><Spinner />Comparing…</> : 'Compare Papers'}
        </button>
        <ErrorNote error={error} />
        {loading && <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>Analysing both papers — ~20s…</p>}
      </div>

      {loading && <DocSkeleton label="Comparing papers" />}

      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Summary + winner */}
          <div style={{ background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.75, marginBottom: 12 }}>{result.summary}</p>
            {result.winner && result.winner !== 'N/A' && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(var(--green-rgb),.08)', border: '1px solid rgba(var(--green-rgb),.25)', borderRadius: 6, padding: '7px 14px' }}>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>Stronger overall:</span>
                <strong style={{ color: 'var(--green)', fontSize: 14 }}>{result.winner}</strong>
                {result.reason && <span style={{ fontSize: 12, color: 'var(--muted)' }}>— {result.reason}</span>}
              </div>
            )}
          </div>

          {/* Comparison table */}
          {result.table?.length > 0 && (
            <div style={{ background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid var(--border)', color: 'var(--muted2)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', width: 130 }}>
                      Aspect
                    </th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid var(--border)', color: 'var(--accent)', fontSize: 12 }}>
                      {titles.a.length > 40 ? titles.a.substring(0, 38) + '…' : titles.a}
                    </th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid var(--border)', color: 'var(--purple)', fontSize: 12 }}>
                      {titles.b.length > 40 ? titles.b.substring(0, 38) + '…' : titles.b}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.table.map((row, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--on-accent)' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--muted)', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', fontSize: 12 }}>
                        {row.aspect}
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)', lineHeight: 1.55, verticalAlign: 'top' }}>
                        {row.paper_a}
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)', lineHeight: 1.55, verticalAlign: 'top' }}>
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
