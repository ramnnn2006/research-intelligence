import React, { useState } from 'react'
import { api } from '../services/api'
import Spinner from '../components/Spinner'

function PaperInput({ label, value, onChange }) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>
        {label}
      </div>
      <input
        value={value.title || ''}
        onChange={e => onChange({ ...value, title: e.target.value })}
        placeholder="Paper title"
        style={{ width: '100%', background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, color: '#e6edf3', padding: '8px 10px', fontSize: 13, outline: 'none', marginBottom: 8, boxSizing: 'border-box' }}
        onFocus={e => e.target.style.borderColor = '#58a6ff'}
        onBlur={e => e.target.style.borderColor = '#30363d'}
      />
      <textarea
        value={value.summary || ''}
        onChange={e => onChange({ ...value, summary: e.target.value })}
        placeholder="Paste abstract here (optional — improves comparison accuracy)"
        rows={5}
        style={{ width: '100%', background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, color: '#e6edf3', padding: '8px 10px', fontSize: 12, outline: 'none', resize: 'vertical', lineHeight: 1.55, boxSizing: 'border-box' }}
        onFocus={e => e.target.style.borderColor = '#58a6ff'}
        onBlur={e => e.target.style.borderColor = '#30363d'}
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

  async function run() {
    if (!pa.title.trim() || !pb.title.trim()) return
    setLoading(true); setError(''); setResult(null)
    try { setResult(await api.compare(pa, pb)) }
    catch (e) { setError(e.message) }
    setLoading(false)
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Input */}
      <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: 20, flexShrink: 0 }}>
        <h2 style={{ fontSize: 16, marginBottom: 4 }}>⚖️ Paper Comparison</h2>
        <p style={{ color: '#8b949e', fontSize: 13, marginBottom: 16 }}>
          Compare two papers side-by-side across methodology, datasets, results, limitations, and novelty
        </p>
        <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
          <PaperInput label="Paper A" value={pa} onChange={setPa} />
          <PaperInput label="Paper B" value={pb} onChange={setPb} />
        </div>
        <button
          onClick={run}
          disabled={loading || !pa.title.trim() || !pb.title.trim()}
          style={{ background: loading ? '#21262d' : '#58a6ff', color: loading ? '#8b949e' : '#000', border: 'none', borderRadius: 6, padding: '8px 24px', fontWeight: 600, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer' }}
        >
          {loading ? <><Spinner />Comparing…</> : 'Compare Papers'}
        </button>
        {error && (
          <div style={{ marginTop: 10, color: '#f85149', fontSize: 13, background: 'rgba(248,81,73,.08)', padding: '8px 12px', borderRadius: 6 }}>
            ⚠️ {error}
          </div>
        )}
        {loading && <p style={{ color: '#8b949e', fontSize: 12, marginTop: 8 }}>Analysing both papers — ~20s…</p>}
      </div>

      {result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Summary + winner */}
          <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: 16 }}>
            <p style={{ fontSize: 13, color: '#c9d1d9', lineHeight: 1.75, marginBottom: 12 }}>{result.summary}</p>
            {result.winner && result.winner !== 'N/A' && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(63,185,80,.08)', border: '1px solid rgba(63,185,80,.25)', borderRadius: 6, padding: '7px 14px' }}>
                <span style={{ fontSize: 12, color: '#8b949e' }}>Stronger overall:</span>
                <strong style={{ color: '#3fb950', fontSize: 14 }}>{result.winner}</strong>
                {result.reason && <span style={{ fontSize: 12, color: '#8b949e' }}>— {result.reason}</span>}
              </div>
            )}
          </div>

          {/* Comparison table */}
          {result.table?.length > 0 && (
            <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: 16, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid #21262d', color: '#6e7681', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em', width: 130 }}>
                      Aspect
                    </th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid #21262d', color: '#58a6ff', fontSize: 12 }}>
                      {pa.title.length > 40 ? pa.title.substring(0, 38) + '…' : pa.title}
                    </th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid #21262d', color: '#bc8cff', fontSize: 12 }}>
                      {pb.title.length > 40 ? pb.title.substring(0, 38) + '…' : pb.title}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.table.map((row, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : '#0d1117' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600, color: '#8b949e', borderBottom: '1px solid #21262d', whiteSpace: 'nowrap', fontSize: 12 }}>
                        {row.aspect}
                      </td>
                      <td style={{ padding: '10px 12px', color: '#c9d1d9', borderBottom: '1px solid #21262d', lineHeight: 1.55, verticalAlign: 'top' }}>
                        {row.paper_a}
                      </td>
                      <td style={{ padding: '10px 12px', color: '#c9d1d9', borderBottom: '1px solid #21262d', lineHeight: 1.55, verticalAlign: 'top' }}>
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
