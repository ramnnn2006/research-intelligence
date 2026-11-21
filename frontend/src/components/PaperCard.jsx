import React from 'react'
import { safeHttpUrl, toText } from '../utils/safe'
import Ic from './Ic'

const badge = {
  arxiv: { bg: 'rgba(var(--accent-rgb),.12)', c: 'var(--accent)' },
  semantic_scholar: { bg: 'rgba(var(--purple-rgb),.15)', c: 'var(--purple)' },
  openalex: { bg: 'rgba(16,185,129,.15)', c: 'var(--teal)' },
}

// onViewCitations / onSelect / onAuthorClick are optional. Controls whose handler is
// missing are not rendered, so read-only lists (e.g. Review) show a plain card.
export default function PaperCard({ paper, onSelect, selected, onViewCitations, onAuthorClick }) {
  const src = badge[paper.source] ? paper.source : (String(paper.url || '').includes('arxiv') ? 'arxiv' : 'semantic_scholar')
  const b = badge[src]
  const href = safeHttpUrl(paper.url || paper.id)
  const inspect = onViewCitations || onSelect
  const authors = (Array.isArray(paper.authors) ? paper.authors : []).map(toText).filter(Boolean)

  const handleCardClick = () => {
    if (onViewCitations) onViewCitations(paper)
    else if (onSelect) onSelect(paper)
  }

  return (
    <div
      className="ri-pc"
      onClick={inspect ? handleCardClick : undefined}
      style={{
        background: 'var(--panel2)',
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 'var(--radius, 8px)',
        padding: '14px',
        cursor: inspect ? 'pointer' : 'default',
        transition: 'border-color .15s, transform .1s',
        display: 'flex',
        flexDirection: 'column',
        gap: 8
      }}
      onMouseEnter={inspect ? (e => e.currentTarget.style.borderColor = 'var(--accent)') : undefined}
      onMouseLeave={inspect ? (e => e.currentTarget.style.borderColor = selected ? 'var(--accent)' : 'var(--border)') : undefined}
    >
      {/* Title & Source Badge */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            style={{ fontWeight: 600, fontSize: 14, color: 'var(--accent)', lineHeight: 1.4, flex: 1, textDecoration: 'none' }}
            onClick={e => e.stopPropagation()}
          >
            {toText(paper.title)}
          </a>
        ) : (
          <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--accent)', lineHeight: 1.4, flex: 1 }}>
            {toText(paper.title)}
          </span>
        )}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          <span style={{
            background: b.bg,
            color: b.c,
            padding: '2px 7px',
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 600,
            whiteSpace: 'nowrap'
          }}>
            {src === 'semantic_scholar' ? 'Scholar' : src === 'openalex' ? 'OpenAlex' : 'ArXiv'}
          </span>
        </div>
      </div>

      {/* Metadata & Authors (clickable only when onAuthorClick is given) */}
      <div className="ri-pc-meta" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 12, color: 'var(--muted)' }}>
        {paper.year && <span><Ic d="cal" /> {toText(paper.year)}</span>}
        {paper.year && authors.length > 0 && <span>·</span>}
        {authors.length > 0 && (onAuthorClick
          ? <>
              <span style={{ color: 'var(--muted2)' }}>Authors:</span>
              {authors.slice(0, 4).map((auth, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="ri-pc-author"
                  title={`Search all papers by ${auth}`}
                  onClick={e => { e.stopPropagation(); onAuthorClick(auth) }}
                  style={{
                    background: 'rgba(var(--ochre-rgb),0.1)',
                    border: '1px solid rgba(var(--ochre-rgb),0.25)',
                    color: 'var(--ochre)',
                    borderRadius: 10,
                    padding: '1px 7px',
                    fontSize: 12,
                    cursor: 'pointer',
                    transition: 'background .15s'
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(var(--ochre-rgb),0.25)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(var(--ochre-rgb),0.1)' }}
                >
                  <Ic d="user" /> {auth}
                </button>
              ))}
              {authors.length > 4 && (
                <span style={{ color: 'var(--muted)', fontSize: 11 }}>+{authors.length - 4} more</span>
              )}
            </>
          : <span>{authors.slice(0, 3).join(', ')}{authors.length > 3 ? ' et al.' : ''}</span>
        )}
        {!inspect && paper.citations ? <span>· {toText(paper.citations)} citations</span> : null}
      </div>

      {/* Abstract/Summary */}
      {paper.summary && (
        <div className="ri-pc-sum" style={{
          fontSize: 12,
          color: 'var(--muted2, var(--text-secondary))',
          lineHeight: 1.55,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: inspect ? 2 : 3,
          WebkitBoxOrient: 'vertical'
        }}>
          {toText(paper.summary)}
        </div>
      )}

      {/* Action footer, only when there is something to inspect */}
      {inspect && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingTop: 4,
          borderTop: '1px solid var(--border)',
          marginTop: 2
        }}>
          <button
            type="button"
            className="ri-pc-btn"
            onClick={e => { e.stopPropagation(); handleCardClick() }}
            style={{
              background: 'rgba(var(--green-rgb),0.12)',
              border: '1px solid rgba(var(--green-rgb),0.3)',
              borderRadius: 6,
              color: 'var(--green-strong)',
              padding: '3px 10px',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              transition: 'background-color .15s, border-color .15s, color .15s, box-shadow .15s'
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(var(--green-rgb),0.22)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(var(--green-rgb),0.12)'}
          >
            <Ic d="chart" /> {onViewCitations ? 'Citations & Network' : 'Select'}
            {paper.citations ? ` (${Number(paper.citations).toLocaleString()})` : ''}
          </button>

          <span className="ri-pc-hint" style={{ fontSize: 11, color: 'var(--muted2)' }}>
            Click card to inspect
          </span>
        </div>
      )}
    </div>
  )
}
