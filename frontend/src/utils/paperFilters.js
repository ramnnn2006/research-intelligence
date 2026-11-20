// Pure helpers for filtering and sorting the Discover paper list.
// A missing citation count means "unknown", never zero.
const toText = v => (v == null ? '' : typeof v === 'string' ? v : (v.name || v.title || String(v)))

export const NO_FILTERS = { text: '', since: 'any', minCites: '', sources: [], sort: 'relevance' }

export const yearOf = p => parseInt(String(p?.year ?? ''), 10) || 0
export const citesOf = p => {
  const c = p?.citations
  return c === null || c === undefined || c === '' || Number.isNaN(Number(c)) ? null : Number(c)
}

export function filtersActive(f) {
  return !!(f.text.trim() || f.since !== 'any' || Number(f.minCites) > 0 || f.sources.length)
}

export function citationCoverage(papers) {
  const known = papers.filter(p => citesOf(p) !== null).length
  return { known, unknown: papers.length - known }
}

// `now` is a parameter so the year cutoff can be tested.
export function applyFilters(papers, f, now = new Date().getFullYear()) {
  const text = f.text.trim().toLowerCase()
  const minC = f.minCites === '' ? null : Math.max(0, Number(f.minCites) || 0)
  let out = papers.filter(p => {
    if (text) {
      const authors = Array.isArray(p.authors) ? p.authors.map(toText).join(' ') : ''
      const hay = `${toText(p.title)} ${toText(p.summary)} ${authors}`.toLowerCase()
      if (!hay.includes(text)) return false
    }
    if (f.since !== 'any') {
      const y = yearOf(p)
      // unknown year cannot satisfy a year filter; "last N years" includes this year and the N before
      if (!y || y < now - Number(f.since)) return false
    }
    if (minC) {   // blank or 0 means no minimum
      const c = citesOf(p)
      if (c === null || c < minC) return false   // unknown citations are hidden, and the UI says so
    }
    if (f.sources.length && !f.sources.includes(p.source)) return false
    return true
  })
  if (f.sort !== 'relevance') {
    const idx = new Map(papers.map((p, i) => [p, i]))
    out = [...out].sort((a, b) => {
      let d = 0
      if (f.sort === 'citations') {
        const ca = citesOf(a), cb = citesOf(b)
        if (ca === null && cb !== null) return 1      // unknown always last
        if (cb === null && ca !== null) return -1
        d = (cb ?? 0) - (ca ?? 0)
      } else if (f.sort === 'newest') {
        const ya = yearOf(a), yb = yearOf(b)
        if (!ya && yb) return 1
        if (!yb && ya) return -1
        d = yb - ya
      } else {
        const ya = yearOf(a), yb = yearOf(b)
        if (!ya && yb) return 1
        if (!yb && ya) return -1
        d = ya - yb
      }
      return d || idx.get(a) - idx.get(b)
    })
  }
  return out
}
