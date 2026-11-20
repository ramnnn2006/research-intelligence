import React from 'react'

/**
 * Compact repo list — one row per repo, no tall cards.
 * Used everywhere repos are shown.
 */
export default function RepoList({ repos, title = '🔧 GitHub Repos' }) {
  if (!repos?.length) return null
  return (
    <div style={{ background: '#FAF6EC', border: '1px solid #E6E0D0', borderRadius: 8, padding: '12px 14px' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#6B3FA0', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.05em' }}>
        {title} ({repos.length})
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {repos.map((r, i) => (
          <a key={i} href={r.url} target="_blank" rel="noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 8px', borderRadius: 5, textDecoration: 'none', transition: 'background .12s' }}
            onMouseEnter={e => e.currentTarget.style.background = '#E6E0D0'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
            <span style={{ fontSize: 12 }}>🔧</span>
            <span style={{ flex: 1, fontSize: 12, color: '#1E4FA0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
              {r.name}
            </span>
            <span style={{ fontSize: 11, color: '#8A8375', flexShrink: 0 }}>⭐ {(r.stars || 0).toLocaleString()}</span>
            {r.language && (
              <span style={{ fontSize: 11, color: '#B08A00', flexShrink: 0, minWidth: 40, textAlign: 'right' }}>{r.language}</span>
            )}
          </a>
        ))}
      </div>
    </div>
  )
}
