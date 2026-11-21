import React, { useState, useEffect } from 'react'
import { api } from '../services/api'
import Graph from './Graph'
import Spinner from './Spinner'
import useDialog from '../hooks/useDialog'
import { safeHttpUrl, toText, asArray } from '../utils/safe'
import Ic from './Ic'

export default function CitationModal({ paper, onClose, onAuthorClick, onSelectPaper }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState('graph') // 'graph' | 'citations' | 'references'
  const dialogRef = useDialog(!!paper, onClose)

  useEffect(() => {
    // drop the previous paper's data so the header never shows a stale paper
    setData(null)
    if (!paper?.title) {
      setLoading(false)
      setError('This paper has no title to look up citations for.')
      return
    }
    let isMounted = true
    setLoading(true)
    setError('')

    api.citations(paper.title, 15)
      .then(res => {
        if (isMounted) {
          setData(res)
          setLoading(false)
        }
      })
      .catch(err => {
        if (isMounted) {
          setError(err.message || 'Failed to load citation data')
          setLoading(false)
        }
      })

    return () => { isMounted = false }
  }, [paper?.title])

  if (!paper) return null

  // the backend returns paper: {} when the title is empty, fall back to the clicked paper
  const rootPaper = data?.paper?.title ? data.paper : paper
  const citingPapers = asArray(data?.citations)
  const referencedPapers = asArray(data?.references)
  const citationCount = Number(data?.citation_count ?? paper.citations ?? citingPapers.length) || 0
  const rootUrl = safeHttpUrl(rootPaper.url)
  const rootAuthors = asArray(rootPaper.authors).map(toText).filter(Boolean)

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(22,33,55, 0.75)',
        backdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        ref={dialogRef} role="dialog" aria-modal="true" aria-label={'Citations for ' + (paper.title || 'paper')} tabIndex={-1}
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--border2)',
          borderRadius: 12,
          width: '100%',
          maxWidth: 960,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 50px rgba(22,33,55,0.6)',
          overflow: 'hidden'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--panel2)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
              <span style={{
                background: 'rgba(var(--green-rgb),0.15)',
                color: 'var(--green)',
                padding: '2px 8px',
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 600
              }}>
                <Ic d="doc" /> Paper Citations &amp; Network
              </span>
              <span style={{
                background: 'rgba(var(--accent-rgb),0.15)',
                color: 'var(--accent)',
                padding: '2px 8px',
                borderRadius: 4,
                fontSize: 11,
                fontWeight: 600
              }}>
                <Ic d="star" /> {citationCount.toLocaleString()} Citations
              </span>
              {rootPaper.year && (
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                  <Ic d="cal" /> Year: {toText(rootPaper.year)}
                </span>
              )}
            </div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', lineHeight: 1.4, margin: '0 0 8px 0' }}>
              {toText(rootPaper.title)}
            </h2>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {rootAuthors.length > 0 && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Authors:</span>}
              {!onAuthorClick && rootAuthors.length > 0 && (
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{rootAuthors.join(', ')}</span>
              )}
              {onAuthorClick && rootAuthors.map((author, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    onClose()
                    onAuthorClick(author)
                  }}
                  title={`Search papers by ${author}`}
                  style={{
                    background: 'rgba(var(--ochre-rgb),0.12)',
                    border: '1px solid rgba(var(--ochre-rgb),0.3)',
                    color: 'var(--ochre)',
                    borderRadius: 12,
                    padding: '2px 9px',
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: 'pointer',
                    transition: 'background-color .15s, border-color .15s, color .15s, box-shadow .15s'
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(var(--ochre-rgb),0.25)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'rgba(var(--ochre-rgb),0.12)'}
                >
                  <Ic d="user" /> {author}
                </button>
              ))}
              {rootUrl && (
                <a
                  href={rootUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    marginLeft: 6,
                    color: 'var(--accent)',
                    fontSize: 12,
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3
                  }}
                >
                  ↗ View External Source
                </a>
              )}
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'var(--border)',
              border: 'none',
              borderRadius: 6,
              color: 'var(--text-secondary)',
              padding: '6px 12px',
              fontSize: 14,
              cursor: 'pointer',
              flexShrink: 0
            }}
          >
            ✕ Close
          </button>
        </div>

        {/* Tab selection */}
        <div style={{
          display: 'flex',
          gap: 8,
          padding: '10px 20px',
          background: 'var(--panel)',
          borderBottom: '1px solid var(--border)',
          alignItems: 'center'
        }}>
          <button
            onClick={() => setActiveTab('graph')}
            style={{
              background: activeTab === 'graph' ? 'var(--border)' : 'none',
              border: `1px solid ${activeTab === 'graph' ? 'var(--accent)' : 'var(--border)'}`,
              color: activeTab === 'graph' ? 'var(--accent)' : 'var(--muted)',
              padding: '6px 14px',
              borderRadius: 6,
              fontSize: 13,
              cursor: 'pointer',
              fontWeight: 500
            }}
          >
            <Ic d="web" /> Citation Topology Graph
          </button>
          <button
            onClick={() => setActiveTab('citations')}
            style={{
              background: activeTab === 'citations' ? 'var(--border)' : 'none',
              border: `1px solid ${activeTab === 'citations' ? 'var(--red)' : 'var(--border)'}`,
              color: activeTab === 'citations' ? 'var(--red)' : 'var(--muted)',
              padding: '6px 14px',
              borderRadius: 6,
              fontSize: 13,
              cursor: 'pointer',
              fontWeight: 500
            }}
          >
            <Ic d="down" /> Citing Papers ({citingPapers.length})
          </button>
          <button
            onClick={() => setActiveTab('references')}
            style={{
              background: activeTab === 'references' ? 'var(--border)' : 'none',
              border: `1px solid ${activeTab === 'references' ? 'var(--accent)' : 'var(--border)'}`,
              color: activeTab === 'references' ? 'var(--accent)' : 'var(--muted)',
              padding: '6px 14px',
              borderRadius: 6,
              fontSize: 13,
              cursor: 'pointer',
              fontWeight: 500
            }}
          >
            <Ic d="up" /> References / Cited ({referencedPapers.length})
          </button>

          {data?.source && (
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted2)' }}>
              Source: <b style={{ color: 'var(--muted)' }}>{toText(data.source)}</b>
            </span>
          )}
        </div>

        {/* Modal body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>
              <Spinner />
              <div style={{ marginTop: 12, fontSize: 14 }}>
                Querying academic citation index &amp; traversing graph...
              </div>
            </div>
          )}

          {error && (
            <div style={{
              background: 'rgba(193,59,46,0.1)',
              border: '1px solid rgba(193,59,46,0.3)',
              borderRadius: 8,
              padding: 16,
              color: 'var(--red)',
              fontSize: 13
            }}>
              <Ic d="warn" /> {error}
            </div>
          )}

          {!loading && !error && (
            <>
              {/* Tab 1: Graph */}
              {activeTab === 'graph' && (
                <div>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    marginBottom: 10,
                    fontSize: 12,
                    color: 'var(--muted)'
                  }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--green)' }}></span>
                      Selected Paper (Root)
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--red)' }}></span>
                      Cited By (Incoming Citations)
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)' }}></span>
                      References (Outgoing Citations)
                    </span>
                  </div>

                  {data?.graph?.nodes?.length > 1 ? (
                    <div style={{ background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
                      <Graph data={data.graph} height={420} />
                    </div>
                  ) : (
                    <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted2)', fontSize: 13 }}>
                      No citation links mapped for this paper yet.
                    </div>
                  )}
                </div>
              )}

              {/* Tab 2: Citing Papers */}
              {activeTab === 'citations' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 6px 0' }}>
                    Papers that cite <b>&ldquo;{toText(rootPaper.title)}&rdquo;</b>:
                  </p>
                  {citingPapers.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted2)', fontSize: 13 }}>
                      No incoming citations found in academic databases for this paper.
                    </div>
                  ) : (
                    citingPapers.map((cp, idx) => (
                      <div
                        key={idx}
                        style={{
                          background: 'var(--panel2)',
                          border: '1px solid var(--border)',
                          borderRadius: 8,
                          padding: 14,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                          <span style={{ color: 'var(--text)', fontWeight: 600, fontSize: 14 }}>
                            {toText(cp.title)}
                          </span>
                          <span style={{
                            background: 'rgba(193,59,46,0.15)',
                            color: 'var(--red)',
                            fontSize: 11,
                            padding: '2px 7px',
                            borderRadius: 4,
                            fontWeight: 600,
                            flexShrink: 0
                          }}>
                            {cp.citations || 0} citations
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--muted)', flexWrap: 'wrap' }}>
                          <span><Ic d="cal" /> {cp.year || 'N/A'}</span>
                          <span>·</span>
                          <span>{asArray(cp.authors).map(toText).join(', ') || 'Authors not listed'}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                          {safeHttpUrl(cp.url) && (
                            <a
                              href={safeHttpUrl(cp.url)}
                              target="_blank"
                              rel="noreferrer"
                              style={{ color: 'var(--accent)', fontSize: 12, textDecoration: 'none' }}
                            >
                              ↗ View Paper
                            </a>
                          )}
                          {onSelectPaper && cp.title && (
                          <button
                            onClick={() => onSelectPaper(cp)}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: 'var(--green)',
                              fontSize: 12,
                              cursor: 'pointer',
                              padding: 0
                            }}
                          >
                            <Ic d="search" /> Explore Citations of this Paper
                          </button>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Tab 3: References */}
              {activeTab === 'references' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 6px 0' }}>
                    Works cited by <b>&ldquo;{toText(rootPaper.title)}&rdquo;</b>:
                  </p>
                  {referencedPapers.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted2)', fontSize: 13 }}>
                      No reference records listed for this paper.
                    </div>
                  ) : (
                    referencedPapers.map((rp, idx) => (
                      <div
                        key={idx}
                        style={{
                          background: 'var(--panel2)',
                          border: '1px solid var(--border)',
                          borderRadius: 8,
                          padding: 14,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 6
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                          <span style={{ color: 'var(--text)', fontWeight: 600, fontSize: 14 }}>
                            {toText(rp.title)}
                          </span>
                          <span style={{
                            background: 'rgba(var(--accent-rgb),0.15)',
                            color: 'var(--accent)',
                            fontSize: 11,
                            padding: '2px 7px',
                            borderRadius: 4,
                            fontWeight: 600,
                            flexShrink: 0
                          }}>
                            {rp.citations || 0} citations
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--muted)', flexWrap: 'wrap' }}>
                          <span><Ic d="cal" /> {rp.year || 'N/A'}</span>
                          <span>·</span>
                          <span>{asArray(rp.authors).map(toText).join(', ') || 'Authors not listed'}</span>
                        </div>
                        {safeHttpUrl(rp.url) && (
                          <div style={{ marginTop: 4 }}>
                            <a
                              href={safeHttpUrl(rp.url)}
                              target="_blank"
                              rel="noreferrer"
                              style={{ color: 'var(--accent)', fontSize: 12, textDecoration: 'none' }}
                            >
                              ↗ View Paper
                            </a>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

