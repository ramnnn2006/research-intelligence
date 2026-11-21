import React from 'react'
import Ic from './Ic'

/**
 * Compact repo list — one row per repo, no tall cards.
 * Used everywhere repos are shown.
 */
export default function RepoList({ repos, title = 'GitHub Repos' }) {
  if (!repos?.length) return null
  return (
    <div style={{ background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 8, padding: '12px 14px' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--purple)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.05em' }}>
        {title} ({repos.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {repos.map((r, i) => (
          <a key={i} href={r.url} target="_blank" rel="noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 5, textDecoration: 'none', transition: 'background .12s' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--border)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <Ic d="wrench" size={12} />
            <span style={{ flex: 1, fontSize: 12, color: 'var(--accent)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
              {r.name}
            </span>
            <span style={{ fontSize: 11, color: 'var(--muted2)', flexShrink: 0 }}><Ic d="star" size={11} /> {(r.stars || 0).toLocaleString()}</span>
            {r.language && (
              <span style={{ fontSize: 11, color: 'var(--ochre)', flexShrink: 0, minWidth: 40, textAlign: 'right' }}>{r.language}</span>
            )}
          </a>
        ))}
      </div>
    </div>
  )
}
