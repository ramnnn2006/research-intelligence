import React, { useState, useRef } from 'react'
import { api } from '../services/api'
import { useTopicField } from '../App'
import PaperCard from '../components/PaperCard'
import Graph from '../components/Graph'
import Spinner from '../components/Spinner'
import ErrorNote from '../components/ErrorNote'
import { PaperSkeletons } from '../components/Skeleton'
import { useToast, useNotifyDone } from '../components/Toast'
import RepoList from '../components/RepoList'
import CitationModal from '../components/CitationModal'
import { ModelCard, DatasetCard } from '../components/HFArtifacts'
import useDialog from '../hooks/useDialog'
import { safeHttpUrl, toText, asArray } from '../utils/safe'
import { NO_FILTERS, applyFilters, filtersActive as isFiltered, citationCoverage } from '../utils/paperFilters'
import Ic from '../components/Ic'
import useWindowedList from '../useWindowedList'
import useVirtualList from '../useVirtualList'

const SOURCE_LABEL = { arxiv: 'ArXiv', semantic_scholar: 'Scholar', openalex: 'OpenAlex' }
const SORTS = [
  ['relevance', 'Best match'],
  ['citations', 'Most cited'],
  ['newest', 'Newest'],
  ['oldest', 'Oldest'],
]

export default function Discover() {
  const toast = useToast()
  const notify = useNotifyDone('discover', 'Discover')
  const [filters, setFilters] = useState(NO_FILTERS)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const setFilter = (k, v) => setFilters(f => ({ ...f, [k]: v }))
  const filtersActive = isFiltered(filters)
  // Mode: 'topic' | 'author'
  const [searchMode, setSearchMode] = useState('topic')
  const [queryError, setQueryError] = useState('')
  const queryRef = useRef(null)
  const authorRef = useRef(null)

  // Topic search state (the field follows the header topic until edited here)
  const [query, setQuery, commitQuery] = useTopicField()
  const [searchedQuery, setSearchedQuery] = useState('')   // query behind the current result
  const subgraphReq = useRef(0)                            // latest subgraph request id
  const [arxiv, setArxiv]           = useState(true)
  const [scholar, setScholar]       = useState(true)
  const [loading, setLoading]       = useState(false)
  const [result, setResult]         = useState(null)
  const [error, setError]           = useState('')
  const [subgraphError, setSubgraphError] = useState('')
  const [showGraph, setShowGraph]   = useState(true)
  const [activeTab, setActiveTab]   = useState('papers') // 'papers' | 'models' | 'datasets' | 'repos'

  // deep-link: reflect the result tab and active filters in the URL hash so a
  // refresh, a shared link, or browser back/forward restores the same view.
  // Filters restored from the URL survive the next search (they are the point
  // of the shared link); later searches reset filters as usual.
  const restoredFromUrl = useRef(false)
  const skipFirstWrite = useRef(true)
  React.useEffect(() => {
    function fromHash() {
      if (!location.hash.startsWith('#discover')) return
      const qs = location.hash.split('?')[1] || ''
      const p = new URLSearchParams(qs)
      const t = p.get('t')
      if (t && ['papers', 'models', 'datasets', 'repos'].includes(t)) setActiveTab(t)
      setFilters(f => ({ ...f,
        text: p.get('q') ?? '',
        since: p.get('year') ?? 'any',
        minCites: p.get('minc') ?? '',
        sort: p.get('sort') ?? 'relevance' }))
      if (qs) restoredFromUrl.current = true
    }
    fromHash()
    window.addEventListener('hashchange', fromHash)
    return () => window.removeEventListener('hashchange', fromHash)
  }, [])
  React.useEffect(() => {
    if (skipFirstWrite.current) { skipFirstWrite.current = false; return }
    if (!location.hash.startsWith('#discover')) return
    const p = new URLSearchParams()
    if (activeTab !== 'papers') p.set('t', activeTab)
    if (filters.text) p.set('q', filters.text)
    if (filters.since !== 'any') p.set('year', filters.since)
    if (filters.minCites !== '' && filters.minCites != null) p.set('minc', String(filters.minCites))
    if (filters.sort !== 'relevance') p.set('sort', filters.sort)
    const qs = p.toString()
    const target = qs ? `#discover?${qs}` : '#discover'
    if (location.hash !== target) history.pushState(null, '', target)
  }, [activeTab, filters])

  // Neo4j citation subgraph (depth slider) and export
  const [depth, setDepth]       = useState(1)
  const [subgraph, setSubgraph] = useState(null)   // neo4j subgraph, replaces the search graph once loaded
  const [graphLoading, setGraphLoading] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const exportRef = useDialog(showExport, () => setShowExport(false))
  const [exportScope, setExportScope]   = useState('topic')
  const [exportFormat, setExportFormat] = useState('json')

  // Author search state
  const [authorQuery, setAuthorQuery]     = useState('')
  const [authorLoading, setAuthorLoading] = useState(false)
  const [authorResult, setAuthorResult]   = useState(null)
  const [authorError, setAuthorError]     = useState('')
  const [authorTab, setAuthorTab]         = useState('papers') // 'papers' | 'coauthors' | 'graph'
  const [authorSort, setAuthorSort]       = useState('citations') // 'citations' | 'year'
  const authorReq = useRef(0)                                     // latest author request id

  // Citation modal state
  const [selectedCitationPaper, setSelectedCitationPaper] = useState(null)

  // ── Actions ──────────────────────────────────────────────────────────────
  async function loadSubgraph(d) {
    const id = ++subgraphReq.current
    setDepth(d); setGraphLoading(true); setSubgraphError('')
    try {
      const r = await fetch(`/api/graph/export/json?scope=topic&topic=${encodeURIComponent(searchedQuery)}&depth=${d}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      if (id === subgraphReq.current) setSubgraph(data)
    } catch (e) {
      if (id === subgraphReq.current) setSubgraphError(`Could not load the ${d}-hop graph: ${e.message}. Showing the previous graph.`)
    } finally {
      // a newer slider move owns the loading flag
      if (id === subgraphReq.current) setGraphLoading(false)
    }
  }

  function resetSubgraph() {
    subgraphReq.current++
    setSubgraph(null); setGraphLoading(false); setDepth(1); setSubgraphError('')
  }

  function downloadExport() {
    const [fmt, table] = exportFormat.split(':')
    let url = `/api/graph/export/${fmt}?scope=${exportScope}&topic=${encodeURIComponent(searchedQuery)}&depth=${depth}`
    if (table) url += `&table=${table}`
    const a = document.createElement('a')
    a.href = url
    a.click()
    setShowExport(false)
    toast({ message: 'Export started. Check your downloads.', kind: 'info' })
  }

  async function searchTopic() {
    if (loading) return
    if (!query.trim()) { setQueryError('Enter a topic to search.'); queryRef.current?.focus(); return }
    setQueryError('')
    const q = query
    commitQuery(q)
    setLoading(true); setError('')
    try {
      const sources = []
      if (arxiv)   sources.push('arxiv')
      if (scholar) sources.push('semantic_scholar')
      // GitHub and Hugging Face are always fetched server-side regardless
      const res = await api.search(q, sources, 12)
      setResult(res)
      const keepRestored = restoredFromUrl.current
      restoredFromUrl.current = false
      if (!keepRestored) setFilters(NO_FILTERS)
      setSearchedQuery(q)
      notify(`Search finished: ${res?.papers?.length || 0} papers for "${q}"`)
      // new result: drop any subgraph (and in-flight subgraph request) and reset depth
      resetSubgraph()
      if (!keepRestored) setActiveTab('papers')
    } catch (e) { setError(e.message); notify(`Search failed: ${e.message}`, 'error') }
    finally { setLoading(false) }
  }

  async function searchAuthor(name) {
    const aName = (name !== undefined ? name : authorQuery).trim()
    if (!aName) { setAuthorError('Enter an author name to search.'); authorRef.current?.focus(); return }
    setAuthorError('')
    // a newer author search (e.g. clicking another author) supersedes the running one
    const id = ++authorReq.current
    setAuthorQuery(aName)
    setAuthorLoading(true); setAuthorError('')
    try {
      const data = await api.searchAuthor(aName, 25)
      if (id !== authorReq.current) return
      setAuthorResult(data)
      setAuthorTab('papers')
    } catch (e) {
      if (id === authorReq.current) setAuthorError(e.message || 'Author search failed')
    } finally {
      if (id === authorReq.current) setAuthorLoading(false)
    }
  }

  function handleAuthorClick(authorName) {
    if (!authorName) return
    setSearchMode('author')
    setAuthorQuery(authorName)
    searchAuthor(authorName)
  }

  // memoized: a fresh array identity every render would reset useWindowedList's count
  const visiblePapers = React.useMemo(() => applyFilters(asArray(result?.papers), filters), [result?.papers, filters])
  const papersWin = useWindowedList(visiblePapers)
  // >50 items: bounded virtualization keeps the DOM small; <=50: incremental sentinel list
  const papersVirt = useVirtualList(visiblePapers)
  const modelsWin = useWindowedList(asArray(result?.models))
  const datasetsWin = useWindowedList(asArray(result?.datasets))
  const coverage = citationCoverage(asArray(result?.papers))
  const scholarMissing = scholar && result && !asArray(result.papers).some(p => p.source === 'semantic_scholar')

  // Sorted author papers
  const authorInfo = authorResult?.author || {}
  const authorAffiliations = asArray(authorInfo.affiliations).map(toText).filter(Boolean)
  const orcidUrl = safeHttpUrl(authorInfo.orcid)
  const sortedAuthorPapers = [...asArray(authorResult?.papers)].sort((a, b) => {
    if (authorSort === 'citations') {
      return (b.citations || 0) - (a.citations || 0)
    }
    return String(b.year || '0').localeCompare(String(a.year || '0'))
  })

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Search Header Container */}
      <div style={{ background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 8, padding: 20, flexShrink: 0 }}>
        
        {/* Mode Toggle Pills */}
        <div className="ri-search-modes" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <button
            type="button"
            onClick={() => setSearchMode('topic')}
            style={{
              background: searchMode === 'topic' ? 'var(--accent2)' : 'var(--border)',
              border: `1px solid ${searchMode === 'topic' ? 'var(--accent)' : 'var(--border2)'}`,
              color: searchMode === 'topic' ? 'var(--on-accent)' : 'var(--text-secondary)',
              padding: '6px 16px',
              borderRadius: 20,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'background-color .15s, border-color .15s, color .15s, box-shadow .15s'
            }}
          >
            <Ic d="doc" /><span className="ri-mode-full">Search by Topic / Title</span><span className="ri-mode-short">Topic / title</span>
          </button>

          <button
            type="button"
            onClick={() => setSearchMode('author')}
            style={{
              background: searchMode === 'author' ? 'var(--purple)' : 'var(--border)',
              border: `1px solid ${searchMode === 'author' ? 'var(--purple)' : 'var(--border2)'}`,
              color: searchMode === 'author' ? 'var(--on-accent)' : 'var(--text-secondary)',
              padding: '6px 16px',
              borderRadius: 20,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'background-color .15s, border-color .15s, color .15s, box-shadow .15s'
            }}
          >
            <Ic d="user" /><span className="ri-mode-full">Search by Author / Researcher</span><span className="ri-mode-short">Author</span>
          </button>
        </div>

        {/* ── Mode A: Topic Search ────────────────────────────────────────── */}
        {searchMode === 'topic' && (
          <div>
            <h2 className="ri-title" style={{ fontSize: 18, marginBottom: 4 }}>Research Paper Discovery</h2>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 14 }}>
              Search papers from ArXiv &amp; Semantic Scholar, view citations, and explore GitHub, HF models &amp; datasets.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <input name="query" autoComplete="off"
                ref={queryRef} aria-invalid={queryError ? true : undefined}
                value={query} onChange={e => { setQuery(e.target.value); if (queryError) setQueryError('') }}
                onKeyDown={e => e.key === 'Enter' && searchTopic()}
                placeholder="e.g. LoRA fine-tuning PEFT, deepseek reasoning, graph neural networks" aria-label="Search papers by topic"
                style={{ flex: 1, minWidth: 'min(260px, 100%)', background: 'var(--panel)', border: '1px solid var(--border2)', borderRadius: 6, color: 'var(--text)', padding: '8px 12px', fontSize: 14 }}
                onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                onBlur={e => e.target.style.borderColor = 'var(--border2)'}
              />
              {queryError && <div role="alert" style={{ flexBasis: '100%', color: 'var(--red-strong)', fontSize: 13 }}>{queryError}</div>}
              <div style={{ display: 'flex', gap: 14, fontSize: 13, color: 'var(--muted)' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={arxiv} onChange={e => setArxiv(e.target.checked)} style={{ accentColor: 'var(--accent)' }} /> ArXiv
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={scholar} onChange={e => setScholar(e.target.checked)} style={{ accentColor: 'var(--accent)' }} /> Scholar
                </label>
                <span style={{ color: 'var(--green)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Ic d="github" /> GitHub <span style={{ color: 'var(--muted2)' }}>(auto)</span>
                </span>
              </div>
              {!arxiv && !scholar && (
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>No paper source is ticked. Only GitHub and Hugging Face results will load, so Papers will be empty.</div>
              )}
              <button onClick={searchTopic} disabled={loading || !query.trim()}
                style={{ background: loading ? 'var(--border)' : 'var(--yellow)', color: loading ? 'var(--muted)' : 'var(--yellow-ink)', border: 'none', borderRadius: 6, padding: '8px 22px', fontWeight: 600, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer' }}>
                {loading ? <><Spinner />Searching…</> : 'Search'}
              </button>
            </div>
            <ErrorNote error={error} />
            {error && result && searchedQuery && (
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>The results below are still the earlier ones for "{searchedQuery}".</div>
            )}
          </div>
        )}

        {/* ── Mode B: Author Search ───────────────────────────────────────── */}
        {searchMode === 'author' && (
          <div>
            <h2 className="ri-title" style={{ fontSize: 18, marginBottom: 4 }}>Author &amp; Researcher Portfolio Search</h2>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 12 }}>
              Find all research papers authored by a researcher, their citation metrics, h-index, affiliations, and co-authors.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <input name="author-query" autoComplete="off"
                ref={authorRef} aria-invalid={authorError ? true : undefined}
                value={authorQuery} onChange={e => { setAuthorQuery(e.target.value); if (authorError) setAuthorError('') }}
                onKeyDown={e => e.key === 'Enter' && searchAuthor()}
                placeholder="e.g. Geoffrey Hinton, Yann LeCun, Ashish Vaswani, Yoshua Bengio, Fei-Fei Li" aria-label="Geoffrey Hinton, Yann LeCun, Ashish Vaswani, Yoshua Bengio, Fei-Fei Li"
                style={{ flex: 1, minWidth: 'min(260px, 100%)', background: 'var(--panel)', border: '1px solid var(--border2)', borderRadius: 6, color: 'var(--text)', padding: '8px 12px', fontSize: 14 }}
                onFocus={e => e.target.style.borderColor = 'var(--purple)'}
                onBlur={e => e.target.style.borderColor = 'var(--border2)'}
              />
              <button onClick={() => searchAuthor()} disabled={authorLoading || !authorQuery.trim()}
                style={{ background: authorLoading ? 'var(--border)' : 'var(--purple)', color: 'var(--on-accent)', border: 'none', borderRadius: 6, padding: '8px 22px', fontWeight: 600, fontSize: 14, cursor: authorLoading ? 'not-allowed' : 'pointer' }}>
                {authorLoading ? <><Spinner />Searching Author…</> : 'Search Author'}
              </button>
            </div>

            {/* Quick Author Suggestion Chips */}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--muted2)' }}>Try:</span>
              {['Ashish Vaswani', 'Geoffrey Hinton', 'Yann LeCun', 'Andrew Ng', 'Yoshua Bengio'].map((name, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => searchAuthor(name)}
                  style={{
                    background: 'none',
                    border: '1px solid var(--border2)',
                    borderRadius: 14,
                    color: 'var(--muted)',
                    fontSize: 11,
                    padding: '2px 10px',
                    cursor: 'pointer'
                  }}
                  onMouseEnter={e => { e.target.style.color = 'var(--text-secondary)'; e.target.style.borderColor = 'var(--accent)' }}
                  onMouseLeave={e => { e.target.style.color = 'var(--muted)'; e.target.style.borderColor = 'var(--border2)' }}
                >
                  {name}
                </button>
              ))}
            </div>

            <ErrorNote error={authorError} />
          </div>
        )}

      </div>

      {searchMode === 'topic' && loading && <PaperSkeletons n={4} />}
      {searchMode === 'author' && authorLoading && <PaperSkeletons n={3} />}

      {/* ── Mode A Results: Topic Search View ─────────────────────────────── */}
      {searchMode === 'topic' && result && (
        <>
          {/* Stats + tab bar */}
          <div className="ri-restabs" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
            <button onClick={() => setActiveTab('papers')}
              style={{ background: activeTab === 'papers' ? 'var(--border)' : 'none', border: `1px solid ${activeTab === 'papers' ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 6, color: activeTab === 'papers' ? 'var(--accent)' : 'var(--muted)', padding: '5px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
              <Ic d="doc" /> Papers ({result.total})
            </button>
            <button onClick={() => setActiveTab('models')}
              style={{ background: activeTab === 'models' ? 'var(--border)' : 'none', border: `1px solid ${activeTab === 'models' ? 'var(--copper)' : 'var(--border)'}`, borderRadius: 6, color: activeTab === 'models' ? 'var(--copper)' : 'var(--muted)', padding: '5px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
              <Ic d="box" /> HF Models ({result.models?.length || 0})
            </button>
            <button onClick={() => setActiveTab('datasets')}
              style={{ background: activeTab === 'datasets' ? 'var(--border)' : 'none', border: `1px solid ${activeTab === 'datasets' ? 'var(--cyan)' : 'var(--border)'}`, borderRadius: 6, color: activeTab === 'datasets' ? 'var(--cyan)' : 'var(--muted)', padding: '5px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
              <Ic d="database" /> Datasets ({result.datasets?.length || 0})
            </button>
            <button onClick={() => setActiveTab('repos')}
              style={{ background: activeTab === 'repos' ? 'var(--border)' : 'none', border: `1px solid ${activeTab === 'repos' ? 'var(--purple)' : 'var(--border)'}`, borderRadius: 6, color: activeTab === 'repos' ? 'var(--purple)' : 'var(--muted)', padding: '5px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
              <Ic d="github" /> GitHub Repos ({result.repos?.length || 0})
            </button>
            <div style={{ background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 12px', fontSize: 12, color: 'var(--muted2)' }}>
              <Ic d="rag" /> {result.rag_count} in RAG
            </div>
            {result.graph_source && (
              <div style={{
                background: result.graph_source === 'neo4j' ? 'rgba(var(--green-rgb),0.1)' : 'rgba(var(--accent-rgb),0.1)',
                border: `1px solid ${result.graph_source === 'neo4j' ? 'rgba(var(--green-rgb),0.3)' : 'rgba(var(--accent-rgb),0.3)'}`,
                borderRadius: 6, padding: '5px 12px', fontSize: 12,
                color: result.graph_source === 'neo4j' ? 'var(--green)' : 'var(--accent)'
              }}>
                {result.graph_source === 'neo4j' ? <><Ic d="web" /> Neo4j Graph</> : <><Ic d="chart" /> NetworkX Graph</>}
              </div>
            )}
            <button onClick={() => setShowGraph(p => !p)}
              style={{ background: 'none', border: '1px solid var(--border2)', borderRadius: 6, color: 'var(--muted)', padding: '5px 12px', fontSize: 12, cursor: 'pointer', marginLeft: 'auto' }}>
              <Ic d={showGraph ? 'minus' : 'plus'} /><span>{showGraph ? 'Hide graph' : 'Show graph'}</span>
            </button>
          </div>

          <div className="ri-results-grid" style={{ display: 'grid', gridTemplateColumns: showGraph && result.graph ? '1fr 400px' : '1fr', gap: 16, alignItems: 'start' }}>

            {/* Main content */}
            <div>
              {/* Papers tab */}
              {activeTab === 'papers' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className="ri-result-tip" style={{ color: 'var(--muted)', fontSize: 12, padding: '0 4px' }}>
                    <Ic d="bulb" /> <i>Tip: Click any paper or &ldquo;Citations &amp; Network&rdquo; to view incoming citations &amp; references. Click any author to view their full portfolio.</i>
                  </div>
                  {result.papers?.length > 0 && (
                    <div className="ri-filters" style={{ background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                      <input name="filter-text" autoComplete="off" type="text" value={filters.text} onChange={e => setFilter('text', e.target.value)}
                        onKeyDown={e => e.key === 'Escape' && setFilter('text', '')}
                        placeholder="Filter within results…" aria-label="Filter within results" style={{ flex: '1 1 180px', minWidth: 140 }} />
                      <button type="button" className="ri-filter-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(o => !o)}>
                        Filters{(filtersActive ? ' (on)' : '')} {filtersOpen ? '▴' : '▾'}
                      </button>
                      <div className={`ri-filter-extra${filtersOpen ? ' open' : ''}`}>
                      <label>Year
                        <select value={filters.since} onChange={e => setFilter('since', e.target.value)}>
                          <option value="any">Any</option>
                          <option value="1">Last year</option>
                          <option value="3">Last 3 years</option>
                          <option value="5">Last 5 years</option>
                        </select>
                      </label>
                      <label title={coverage.known ? 'Papers with no citation count are hidden when this is set' : 'No citation counts came back for these results'}>Min citations
                        <input name="min-citations" autoComplete="off" inputMode="numeric" type="number" min="0" value={filters.minCites} disabled={!coverage.known}
                          onChange={e => setFilter('minCites', e.target.value)} style={{ width: 70 }} />
                      </label>
                      {[...new Set(result.papers.map(p => p.source).filter(Boolean))].length > 1 && (
                        [...new Set(result.papers.map(p => p.source).filter(Boolean))].map(src => (
                          <button key={src} type="button" className={`ri-chip${filters.sources.includes(src) ? ' on' : ''}`}
                            aria-pressed={filters.sources.includes(src)}
                            onClick={() => setFilter('sources', filters.sources.includes(src) ? filters.sources.filter(x => x !== src) : [...filters.sources, src])}>
                            {SOURCE_LABEL[src] || src}
                          </button>
                        ))
                      )}
                      <label>Sort
                        <select value={filters.sort} onChange={e => setFilter('sort', e.target.value)}>
                          {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </label>
                      </div>
                      <span style={{ marginLeft: 'auto', color: 'var(--muted2)' }} aria-live="polite">
                        {filtersActive ? `Showing ${visiblePapers.length} of ${result.papers.length}` : `${result.papers.length} papers`}{searchedQuery ? ` for "${searchedQuery}"` : ''}
                      </span>
                      {(filtersActive || filters.sort !== 'relevance') && (
                        <button type="button" className="ri-chip" onClick={() => setFilters(NO_FILTERS)}>Clear</button>
                      )}
                    </div>
                  )}
                  {result.papers?.length > 0 && coverage.unknown > 0 && (
                    <div className="ri-note" role="note">
                      {coverage.known === 0
                        ? 'Citation counts are not available for these results.'
                        : `${coverage.unknown} of ${result.papers.length} papers have no citation count.`}
                      <details>
                        <summary>More</summary>
                        {coverage.known === 0
                          ? `None of the ${result.papers.length} papers carry a count${scholarMissing ? ', and no Semantic Scholar papers came back in this search. The app was not told why' : ''}. Min citations is disabled and Most cited keeps the original order.`
                          : 'A minimum citation filter hides papers without a count, and Most cited lists them last.'}
                      </details>
                    </div>
                  )}
                  {!result.papers?.length
                    ? <div style={{ color: 'var(--muted2)', fontSize: 13, padding: 20, textAlign: 'center' }}>No papers found. Try different keywords.</div>
                    : !visiblePapers.length
                    ? <div style={{ color: 'var(--muted2)', fontSize: 13, padding: 20, textAlign: 'center' }}>
                        No papers match these filters. <button type="button" className="ri-chip" onClick={() => setFilters(NO_FILTERS)}>Clear filters</button>
                      </div>
                    : visiblePapers.length > 50
                    ? (
                      <div ref={papersVirt.ref}>
                        <div style={{ height: papersVirt.topPad }} aria-hidden="true" />
                        {papersVirt.visible.map(p => (
                          <div key={p.id || p.url || p.title} data-vl-item style={{ marginBottom: 10 }}>
                            <PaperCard
                              paper={p}
                              onViewCitations={setSelectedCitationPaper}
                              onAuthorClick={handleAuthorClick}
                            />
                          </div>
                        ))}
                        <div style={{ height: papersVirt.bottomPad }} aria-hidden="true" />
                        <div style={{ padding: 14, textAlign: 'center', color: 'var(--muted2)', fontSize: 13 }}>
                          {papersVirt.total} papers, mounted around the viewport as you scroll
                        </div>
                      </div>
                    )
                    : papersWin.visible.map((p, i) => (
                      <div key={p.id || p.url || p.title} className="ri-enter" style={{ '--i': Math.min(i, 7) }}>
                        <PaperCard
                          paper={p}
                          onViewCitations={setSelectedCitationPaper}
                          onAuthorClick={handleAuthorClick}
                        />
                      </div>
                    ))
                  }
                  {visiblePapers.length <= 50 && papersWin.hasMore && (
                    <div ref={papersWin.sentinelRef} style={{ padding: 14, textAlign: 'center', color: 'var(--muted2)', fontSize: 13 }}>
                      Showing {papersWin.shown} of {papersWin.total} papers…
                    </div>
                  )}
                </div>
              )}

              {/* Models tab */}
              {activeTab === 'models' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {!result.models?.length ? (
                    <div style={{ color: 'var(--muted2)', fontSize: 13, padding: 20, textAlign: 'center' }}>
                      No Hugging Face models found matching this topic.
                    </div>
                  ) : (
                    modelsWin.visible.map((m, i) => <ModelCard key={i} model={m} />)
                  )}
                  {modelsWin.hasMore && (
                    <div ref={modelsWin.sentinelRef} style={{ padding: 14, textAlign: 'center', color: 'var(--muted2)', fontSize: 13 }}>
                      Showing {modelsWin.shown} of {modelsWin.total} models…
                    </div>
                  )}
                </div>
              )}

              {/* Datasets tab */}
              {activeTab === 'datasets' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {!result.datasets?.length ? (
                    <div style={{ color: 'var(--muted2)', fontSize: 13, padding: 20, textAlign: 'center' }}>
                      No Hugging Face benchmark datasets found matching this topic.
                    </div>
                  ) : (
                    datasetsWin.visible.map((d, i) => <DatasetCard key={i} dataset={d} />)
                  )}
                  {datasetsWin.hasMore && (
                    <div ref={datasetsWin.sentinelRef} style={{ padding: 14, textAlign: 'center', color: 'var(--muted2)', fontSize: 13 }}>
                      Showing {datasetsWin.shown} of {datasetsWin.total} datasets…
                    </div>
                  )}
                </div>
              )}

              {/* Repos tab */}
              {activeTab === 'repos' && (
                <RepoList repos={result.repos} title="GitHub Repos" />
              )}
            </div>

            {/* Graph panel */}
            {showGraph && result.graph && (
              <div style={{ background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, position: 'sticky', top: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <h3 style={{ fontSize: 13, fontWeight: 600 }}>{subgraph ? `Neo4j Subgraph (${subgraph.nodes?.length || 0} nodes)` : 'Knowledge Graph'}</h3>
                  {graphLoading && <Spinner />}
                  {subgraph && (
                    <button onClick={resetSubgraph}
                      style={{ background: 'none', border: 'none', color: 'var(--muted2)', fontSize: 11, cursor: 'pointer', padding: 0 }}>
                      reset
                    </button>
                  )}
                  <button onClick={() => setShowExport(true)}
                    style={{ marginLeft: 'auto', background: 'none', border: '1px solid var(--border2)', borderRadius: 6, color: 'var(--muted)', padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}>
                    ⤓ Export Subgraph
                  </button>
                </div>
                <Graph data={subgraph || result.graph} height={480} depth={depth} onDepthChange={loadSubgraph} />
                <ErrorNote error={subgraphError} />
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Mode B Results: Author Portfolio View ─────────────────────────── */}
      {searchMode === 'author' && authorResult && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Author Profile Hero Card */}
          <div style={{
            background: 'linear-gradient(180deg, var(--panel2) 0%, var(--panel) 100%)',
            border: '1px solid var(--border2)',
            borderRadius: 10,
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 12
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                <div style={{
                  width: 52,
                  height: 52,
                  borderRadius: '50%',
                  background: 'var(--panel2)',
                  border: '1px solid var(--border2)',
                  color: 'var(--accent)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 22,
                  fontWeight: 600
                }}>
                  {toText(authorInfo.name).charAt(0).toUpperCase()}
                </div>
                <div>
                  <h2 style={{ fontSize: 20, fontWeight: 600, color: 'var(--accent2)', margin: '0 0 4px 0' }}>
                    {toText(authorInfo.name)}
                  </h2>
                  <div style={{ fontSize: 13, color: 'var(--muted)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {authorAffiliations.length > 0 ? (
                      authorAffiliations.map((aff, i) => (
                        <span key={i}><Ic d="uni" /> {aff}{i < authorAffiliations.length - 1 ? ' ·' : ''}</span>
                      ))
                    ) : (
                      <span>Researcher &amp; Computer Scientist</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Badges / Metrics */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ background: 'var(--panel2)', border: '1px solid var(--border2)', borderRadius: 8, padding: '6px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>Total Works</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--accent)' }}>
                    {authorResult.author?.works_count || authorResult.total_papers || 0}
                  </div>
                </div>
                <div style={{ background: 'var(--panel2)', border: '1px solid var(--border2)', borderRadius: 8, padding: '6px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>Citations</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>
                    {(Number(authorInfo.citation_count) || 0).toLocaleString()}
                  </div>
                </div>
                <div style={{ background: 'var(--panel2)', border: '1px solid var(--border2)', borderRadius: 8, padding: '6px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>h-index</div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>
                    {authorResult.author?.h_index || 'N/A'}
                  </div>
                </div>
                {orcidUrl && (
                  <a
                    href={orcidUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      background: 'rgba(166,226,46,0.1)',
                      border: '1px solid rgba(166,226,46,0.3)',
                      borderRadius: 8,
                      padding: '6px 12px',
                      color: 'var(--lime)',
                      fontSize: 12,
                      textDecoration: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4
                    }}
                  >
                    🆔 ORCID
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* Author Tab Navigation */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={() => setAuthorTab('papers')}
              style={{
                background: authorTab === 'papers' ? 'var(--border)' : 'none',
                border: `1px solid ${authorTab === 'papers' ? 'var(--purple)' : 'var(--border)'}`,
                borderRadius: 6,
                color: authorTab === 'papers' ? 'var(--purple)' : 'var(--muted)',
                padding: '6px 16px',
                fontSize: 13,
                cursor: 'pointer',
                fontWeight: 500
              }}
            >
              <Ic d="doc" /> Research Papers ({authorResult.papers?.length || 0})
            </button>
            <button
              onClick={() => setAuthorTab('coauthors')}
              style={{
                background: authorTab === 'coauthors' ? 'var(--border)' : 'none',
                border: `1px solid ${authorTab === 'coauthors' ? 'var(--orange)' : 'var(--border)'}`,
                borderRadius: 6,
                color: authorTab === 'coauthors' ? 'var(--ochre)' : 'var(--muted)',
                padding: '6px 16px',
                fontSize: 13,
                cursor: 'pointer',
                fontWeight: 500
              }}
            >
              <Ic d="users" /> Frequent Co-Authors ({authorResult.co_authors?.length || 0})
            </button>
            <button
              onClick={() => setAuthorTab('graph')}
              style={{
                background: authorTab === 'graph' ? 'var(--border)' : 'none',
                border: `1px solid ${authorTab === 'graph' ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 6,
                color: authorTab === 'graph' ? 'var(--accent)' : 'var(--muted)',
                padding: '6px 16px',
                fontSize: 13,
                cursor: 'pointer',
                fontWeight: 500
              }}
            >
              <Ic d="web" /> Collaboration Graph
            </button>

            {authorTab === 'papers' && (
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
                <span>Sort by:</span>
                <button
                  onClick={() => setAuthorSort('citations')}
                  style={{
                    background: authorSort === 'citations' ? 'var(--border)' : 'none',
                    border: '1px solid var(--border2)',
                    color: authorSort === 'citations' ? 'var(--accent)' : 'var(--muted)',
                    borderRadius: 4,
                    padding: '2px 8px',
                    fontSize: 11,
                    cursor: 'pointer'
                  }}
                >
                  Most Cited
                </button>
                <button
                  onClick={() => setAuthorSort('year')}
                  style={{
                    background: authorSort === 'year' ? 'var(--border)' : 'none',
                    border: '1px solid var(--border2)',
                    color: authorSort === 'year' ? 'var(--accent)' : 'var(--muted)',
                    borderRadius: 4,
                    padding: '2px 8px',
                    fontSize: 11,
                    cursor: 'pointer'
                  }}
                >
                  Newest (Year)
                </button>
              </div>
            )}
          </div>

          {/* Author Tab 1: Papers */}
          {authorTab === 'papers' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {sortedAuthorPapers.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted2)' }}>
                  No papers found for this author.
                </div>
              ) : (
                sortedAuthorPapers.map((p, i) => (
                  <PaperCard
                    key={i}
                    paper={p}
                    onViewCitations={setSelectedCitationPaper}
                    onAuthorClick={handleAuthorClick}
                  />
                ))
              )}
            </div>
          )}

          {/* Author Tab 2: Co-authors */}
          {authorTab === 'coauthors' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
              {asArray(authorResult.co_authors).map((ca, i) => (
                <div
                  key={i}
                  style={{
                    background: 'var(--panel2)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: 14,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 14 }}>
                      <Ic d="user" /> {toText(ca.name)}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                      {toText(ca.collaborations)} joint publications
                    </div>
                  </div>
                  <button
                    onClick={() => handleAuthorClick(ca.name)}
                    style={{
                      background: 'rgba(107,63,160,0.15)',
                      border: '1px solid rgba(107,63,160,0.3)',
                      color: 'var(--purple)',
                      borderRadius: 6,
                      padding: '4px 10px',
                      fontSize: 12,
                      cursor: 'pointer',
                      fontWeight: 500
                    }}
                  >
                    View Papers →
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Author Tab 3: Collaboration Graph */}
          {authorTab === 'graph' && (
            <div style={{ background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
              <div style={{ display: 'flex', gap: 16, marginBottom: 10, fontSize: 12, color: 'var(--muted)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--orange)', boxShadow: '0 0 0 2px var(--on-accent)' }}></span>
                  Researcher (Gold, white ring)
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--muted)' }}></span>
                  Authored Papers (Gray)
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--orange)' }}></span>
                  Co-Authors (Gold)
                </span>
              </div>
              {authorResult.graph?.nodes?.length > 1 ? (
                <Graph data={authorResult.graph} height={500} />
              ) : (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted2)' }}>
                  Not enough nodes to build author collaboration graph.
                </div>
              )}
            </div>
          )}

        </div>
      )}

      {/* Export modal */}
      {showExport && (
        <div onClick={() => setShowExport(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(1,4,9,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div ref={exportRef} role="dialog" aria-modal="true" aria-label="Export subgraph" tabIndex={-1} onClick={e => e.stopPropagation()}
            style={{ background: 'var(--panel2)', border: '1px solid var(--border2)', borderRadius: 8, padding: 20, width: 'min(340px, calc(100vw - 32px))', display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
            <h3 style={{ fontSize: 15 }}>Export Subgraph</h3>
            <p style={{ color: 'var(--muted)', fontSize: 12 }}>
              Seeds: papers found for "{searchedQuery}" · {depth}-hop traversal
            </p>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, color: 'var(--muted)' }}>
              What to export
              <select value={exportScope} onChange={e => setExportScope(e.target.value)} style={selectStyle}>
                <option value="citations">Citation paths</option>
                <option value="authors">Author network</option>
                <option value="topic">Whole topic subgraph</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, color: 'var(--muted)' }}>
              Format
              <select value={exportFormat} onChange={e => setExportFormat(e.target.value)} style={selectStyle}>
                <option value="json">JSON (nodes + links)</option>
                <option value="csv:edges">CSV edge list</option>
                <option value="csv:nodes">CSV node table</option>
              </select>
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button onClick={() => setShowExport(false)}
                style={{ background: 'none', border: '1px solid var(--border2)', borderRadius: 6, color: 'var(--muted)', padding: '6px 14px', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={downloadExport}
                style={{ background: 'var(--accent)', border: 'none', borderRadius: 6, color: 'var(--on-accent)', fontWeight: 600, padding: '6px 14px', cursor: 'pointer' }}>
                Download
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Citation Modal (Shared across any paper clicked) ─────────────── */}
      {selectedCitationPaper && (
        <CitationModal
          paper={selectedCitationPaper}
          onClose={() => setSelectedCitationPaper(null)}
          onAuthorClick={handleAuthorClick}
          onSelectPaper={p => setSelectedCitationPaper(p)}
        />
      )}

    </div>
  )
}

const selectStyle = { background: 'var(--panel)', border: '1px solid var(--border2)', borderRadius: 6, color: 'var(--text)', padding: '6px 8px', fontSize: 13 }
