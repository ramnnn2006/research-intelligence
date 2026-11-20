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
    if (!query.trim() || loading) return
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
      setFilters(NO_FILTERS)
      setSearchedQuery(q)
      notify(`Search finished: ${res?.papers?.length || 0} papers for "${q}"`)
      // new result: drop any subgraph (and in-flight subgraph request) and reset depth
      resetSubgraph()
      setActiveTab('papers')
    } catch (e) { setError(e.message); notify(`Search failed: ${e.message}`, 'error') }
    finally { setLoading(false) }
  }

  async function searchAuthor(name) {
    const aName = (name !== undefined ? name : authorQuery).trim()
    if (!aName) return
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

  const visiblePapers = applyFilters(asArray(result?.papers), filters)
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
      <div style={{ background: '#FAF6EC', border: '1px solid #E6E0D0', borderRadius: 8, padding: 20, flexShrink: 0 }}>
        
        {/* Mode Toggle Pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <button
            type="button"
            onClick={() => setSearchMode('topic')}
            style={{
              background: searchMode === 'topic' ? '#16397A' : '#E6E0D0',
              border: `1px solid ${searchMode === 'topic' ? '#1E4FA0' : '#D9D2BE'}`,
              color: searchMode === 'topic' ? '#ffffff' : '#6E6858',
              padding: '6px 16px',
              borderRadius: 20,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.15s'
            }}
          >
            📄 Search by Topic / Title
          </button>

          <button
            type="button"
            onClick={() => setSearchMode('author')}
            style={{
              background: searchMode === 'author' ? '#6B3FA0' : '#E6E0D0',
              border: `1px solid ${searchMode === 'author' ? '#6B3FA0' : '#D9D2BE'}`,
              color: searchMode === 'author' ? '#ffffff' : '#6E6858',
              padding: '6px 16px',
              borderRadius: 20,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.15s'
            }}
          >
            👤 Search by Author / Researcher
          </button>
        </div>

        {/* ── Mode A: Topic Search ────────────────────────────────────────── */}
        {searchMode === 'topic' && (
          <div>
            <h2 className="ri-title" style={{ fontSize: 18, marginBottom: 4 }}>Research Paper Discovery</h2>
            <p style={{ color: '#6E6858', fontSize: 13, marginBottom: 14 }}>
              Search papers from ArXiv &amp; Semantic Scholar, view citations, and explore GitHub, HF models &amp; datasets.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                value={query} onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && searchTopic()}
                placeholder="e.g. LoRA fine-tuning PEFT, deepseek reasoning, graph neural networks" aria-label="LoRA fine-tuning PEFT, deepseek reasoning, graph neural networks"
                style={{ flex: 1, minWidth: 'min(260px, 100%)', background: '#FFFFFF', border: '1px solid #D9D2BE', borderRadius: 6, color: '#2B3A55', padding: '8px 12px', fontSize: 14, outline: 'none' }}
                onFocus={e => e.target.style.borderColor = '#1E4FA0'}
                onBlur={e => e.target.style.borderColor = '#D9D2BE'}
              />
              <div style={{ display: 'flex', gap: 14, fontSize: 13, color: '#6E6858' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={arxiv} onChange={e => setArxiv(e.target.checked)} style={{ accentColor: '#1E4FA0' }} /> ArXiv
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={scholar} onChange={e => setScholar(e.target.checked)} style={{ accentColor: '#1E4FA0' }} /> Scholar
                </label>
                <span style={{ color: '#2E7D46', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                  🔧 GitHub <span style={{ color: '#8A8375' }}>(auto)</span>
                </span>
              </div>
              {!arxiv && !scholar && (
                <div style={{ fontSize: 12, color: '#6E6858' }}>No paper source is ticked. Only GitHub and Hugging Face results will load, so Papers will be empty.</div>
              )}
              <button onClick={searchTopic} disabled={loading || !query.trim()}
                style={{ background: loading ? '#E6E0D0' : '#F4D90C', color: loading ? '#6E6858' : '#16397A', border: 'none', borderRadius: 6, padding: '8px 22px', fontWeight: 600, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer' }}>
                {loading ? <><Spinner />Searching…</> : 'Search'}
              </button>
            </div>
            <ErrorNote error={error} />
            {error && result && searchedQuery && (
              <div style={{ fontSize: 12, color: '#6E6858', marginTop: 6 }}>The results below are still the earlier ones for "{searchedQuery}".</div>
            )}
          </div>
        )}

        {/* ── Mode B: Author Search ───────────────────────────────────────── */}
        {searchMode === 'author' && (
          <div>
            <h2 className="ri-title" style={{ fontSize: 18, marginBottom: 4 }}>Author &amp; Researcher Portfolio Search</h2>
            <p style={{ color: '#6E6858', fontSize: 13, marginBottom: 12 }}>
              Find all research papers authored by a researcher, their citation metrics, h-index, affiliations, and co-authors.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                value={authorQuery} onChange={e => setAuthorQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && searchAuthor()}
                placeholder="e.g. Geoffrey Hinton, Yann LeCun, Ashish Vaswani, Yoshua Bengio, Fei-Fei Li" aria-label="Geoffrey Hinton, Yann LeCun, Ashish Vaswani, Yoshua Bengio, Fei-Fei Li"
                style={{ flex: 1, minWidth: 'min(260px, 100%)', background: '#FFFFFF', border: '1px solid #D9D2BE', borderRadius: 6, color: '#2B3A55', padding: '8px 12px', fontSize: 14, outline: 'none' }}
                onFocus={e => e.target.style.borderColor = '#6B3FA0'}
                onBlur={e => e.target.style.borderColor = '#D9D2BE'}
              />
              <button onClick={() => searchAuthor()} disabled={authorLoading || !authorQuery.trim()}
                style={{ background: authorLoading ? '#E6E0D0' : '#6B3FA0', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 22px', fontWeight: 600, fontSize: 14, cursor: authorLoading ? 'not-allowed' : 'pointer' }}>
                {authorLoading ? <><Spinner />Searching Author…</> : 'Search Author'}
              </button>
            </div>

            {/* Quick Author Suggestion Chips */}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: '#8A8375' }}>Try:</span>
              {['Ashish Vaswani', 'Geoffrey Hinton', 'Yann LeCun', 'Andrew Ng', 'Yoshua Bengio'].map((name, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => searchAuthor(name)}
                  style={{
                    background: 'none',
                    border: '1px solid #D9D2BE',
                    borderRadius: 14,
                    color: '#6E6858',
                    fontSize: 11,
                    padding: '2px 10px',
                    cursor: 'pointer'
                  }}
                  onMouseEnter={e => { e.target.style.color = '#44516E'; e.target.style.borderColor = '#1E4FA0' }}
                  onMouseLeave={e => { e.target.style.color = '#6E6858'; e.target.style.borderColor = '#D9D2BE' }}
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
              style={{ background: activeTab === 'papers' ? '#E6E0D0' : 'none', border: `1px solid ${activeTab === 'papers' ? '#1E4FA0' : '#E6E0D0'}`, borderRadius: 6, color: activeTab === 'papers' ? '#1E4FA0' : '#6E6858', padding: '5px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
              📄 Papers ({result.total})
            </button>
            <button onClick={() => setActiveTab('models')}
              style={{ background: activeTab === 'models' ? '#E6E0D0' : 'none', border: `1px solid ${activeTab === 'models' ? '#BF6210' : '#E6E0D0'}`, borderRadius: 6, color: activeTab === 'models' ? '#BF6210' : '#6E6858', padding: '5px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
              🤗 HF Models ({result.models?.length || 0})
            </button>
            <button onClick={() => setActiveTab('datasets')}
              style={{ background: activeTab === 'datasets' ? '#E6E0D0' : 'none', border: `1px solid ${activeTab === 'datasets' ? '#0E7490' : '#E6E0D0'}`, borderRadius: 6, color: activeTab === 'datasets' ? '#0E7490' : '#6E6858', padding: '5px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
              📊 Datasets ({result.datasets?.length || 0})
            </button>
            <button onClick={() => setActiveTab('repos')}
              style={{ background: activeTab === 'repos' ? '#E6E0D0' : 'none', border: `1px solid ${activeTab === 'repos' ? '#6B3FA0' : '#E6E0D0'}`, borderRadius: 6, color: activeTab === 'repos' ? '#6B3FA0' : '#6E6858', padding: '5px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
              🔧 GitHub Repos ({result.repos?.length || 0})
            </button>
            <div style={{ background: '#FAF6EC', border: '1px solid #E6E0D0', borderRadius: 6, padding: '5px 12px', fontSize: 12, color: '#8A8375' }}>
              🧠 {result.rag_count} in RAG
            </div>
            {result.graph_source && (
              <div style={{
                background: result.graph_source === 'neo4j' ? 'rgba(46,125,70,0.1)' : 'rgba(30,79,160,0.1)',
                border: `1px solid ${result.graph_source === 'neo4j' ? 'rgba(46,125,70,0.3)' : 'rgba(30,79,160,0.3)'}`,
                borderRadius: 6, padding: '5px 12px', fontSize: 12,
                color: result.graph_source === 'neo4j' ? '#2E7D46' : '#1E4FA0'
              }}>
                {result.graph_source === 'neo4j' ? '🌿 Neo4j Graph' : '📊 NetworkX Graph'}
              </div>
            )}
            <button onClick={() => setShowGraph(p => !p)}
              style={{ background: 'none', border: '1px solid #D9D2BE', borderRadius: 6, color: '#6E6858', padding: '5px 12px', fontSize: 12, cursor: 'pointer', marginLeft: 'auto' }}>
              {showGraph ? '⊟ Hide Graph' : '⊞ Show Graph'}
            </button>
          </div>

          <div className="ri-results-grid" style={{ display: 'grid', gridTemplateColumns: showGraph && result.graph ? '1fr 400px' : '1fr', gap: 16, alignItems: 'start' }}>

            {/* Main content */}
            <div>
              {/* Papers tab */}
              {activeTab === 'papers' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ color: '#6E6858', fontSize: 12, padding: '0 4px' }}>
                    💡 <i>Tip: Click any paper or &ldquo;Citations &amp; Network&rdquo; to view incoming citations &amp; references. Click any author to view their full portfolio.</i>
                  </div>
                  {result.papers?.length > 0 && (
                    <div className="ri-filters" style={{ background: '#FAF6EC', border: '1px solid #E6E0D0', borderRadius: 8, padding: '10px 12px' }}>
                      <input type="text" value={filters.text} onChange={e => setFilter('text', e.target.value)}
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
                        <input type="number" min="0" value={filters.minCites} disabled={!coverage.known}
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
                      <span style={{ marginLeft: 'auto', color: '#8A8375' }} aria-live="polite">
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
                    ? <div style={{ color: '#8A8375', fontSize: 13, padding: 20, textAlign: 'center' }}>No papers found. Try different keywords.</div>
                    : !visiblePapers.length
                    ? <div style={{ color: '#8A8375', fontSize: 13, padding: 20, textAlign: 'center' }}>
                        No papers match these filters. <button type="button" className="ri-chip" onClick={() => setFilters(NO_FILTERS)}>Clear filters</button>
                      </div>
                    : visiblePapers.map((p, i) => (
                      <div key={p.id || p.url || p.title} className="ri-enter" style={{ '--i': Math.min(i, 7) }}>
                        <PaperCard
                          paper={p}
                          onViewCitations={setSelectedCitationPaper}
                          onAuthorClick={handleAuthorClick}
                        />
                      </div>
                    ))
                  }
                </div>
              )}

              {/* Models tab */}
              {activeTab === 'models' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {!result.models?.length ? (
                    <div style={{ color: '#8A8375', fontSize: 13, padding: 20, textAlign: 'center' }}>
                      No Hugging Face models found matching this topic.
                    </div>
                  ) : (
                    result.models.map((m, i) => <ModelCard key={i} model={m} />)
                  )}
                </div>
              )}

              {/* Datasets tab */}
              {activeTab === 'datasets' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {!result.datasets?.length ? (
                    <div style={{ color: '#8A8375', fontSize: 13, padding: 20, textAlign: 'center' }}>
                      No Hugging Face benchmark datasets found matching this topic.
                    </div>
                  ) : (
                    result.datasets.map((d, i) => <DatasetCard key={i} dataset={d} />)
                  )}
                </div>
              )}

              {/* Repos tab */}
              {activeTab === 'repos' && (
                <RepoList repos={result.repos} title="🔧 GitHub Repos" />
              )}
            </div>

            {/* Graph panel */}
            {showGraph && result.graph && (
              <div style={{ background: '#FAF6EC', border: '1px solid #E6E0D0', borderRadius: 8, padding: 16, position: 'sticky', top: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <h3 style={{ fontSize: 13, fontWeight: 600 }}>{subgraph ? `Neo4j Subgraph (${subgraph.nodes?.length || 0} nodes)` : 'Knowledge Graph'}</h3>
                  {graphLoading && <Spinner />}
                  {subgraph && (
                    <button onClick={resetSubgraph}
                      style={{ background: 'none', border: 'none', color: '#8A8375', fontSize: 11, cursor: 'pointer', padding: 0 }}>
                      reset
                    </button>
                  )}
                  <button onClick={() => setShowExport(true)}
                    style={{ marginLeft: 'auto', background: 'none', border: '1px solid #D9D2BE', borderRadius: 6, color: '#6E6858', padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}>
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
            background: 'linear-gradient(180deg, #FAF6EC 0%, #FFFFFF 100%)',
            border: '1px solid #D9D2BE',
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
                  background: 'linear-gradient(135deg, #6B3FA0 0%, #B08A00 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 24,
                  boxShadow: '0 4px 12px rgba(107,63,160,0.3)'
                }}>
                  👤
                </div>
                <div>
                  <h2 style={{ fontSize: 20, fontWeight: 700, color: '#16397A', margin: '0 0 4px 0' }}>
                    {toText(authorInfo.name)}
                  </h2>
                  <div style={{ fontSize: 13, color: '#6E6858', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {authorAffiliations.length > 0 ? (
                      authorAffiliations.map((aff, i) => (
                        <span key={i}>🏛️ {aff}{i < authorAffiliations.length - 1 ? ' ·' : ''}</span>
                      ))
                    ) : (
                      <span>Researcher &amp; Computer Scientist</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Badges / Metrics */}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ background: '#FAF6EC', border: '1px solid #D9D2BE', borderRadius: 8, padding: '6px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#6E6858', textTransform: 'uppercase', fontWeight: 600 }}>Total Works</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#1E4FA0' }}>
                    {authorResult.author?.works_count || authorResult.total_papers || 0}
                  </div>
                </div>
                <div style={{ background: '#FAF6EC', border: '1px solid #D9D2BE', borderRadius: 8, padding: '6px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#6E6858', textTransform: 'uppercase', fontWeight: 600 }}>Citations</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#C13B2E' }}>
                    {(Number(authorInfo.citation_count) || 0).toLocaleString()}
                  </div>
                </div>
                <div style={{ background: '#FAF6EC', border: '1px solid #D9D2BE', borderRadius: 8, padding: '6px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#6E6858', textTransform: 'uppercase', fontWeight: 600 }}>h-index</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#B08A00' }}>
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
                      color: '#5A8A00',
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
                background: authorTab === 'papers' ? '#E6E0D0' : 'none',
                border: `1px solid ${authorTab === 'papers' ? '#6B3FA0' : '#E6E0D0'}`,
                borderRadius: 6,
                color: authorTab === 'papers' ? '#7A4FB8' : '#6E6858',
                padding: '6px 16px',
                fontSize: 13,
                cursor: 'pointer',
                fontWeight: 500
              }}
            >
              📄 Research Papers ({authorResult.papers?.length || 0})
            </button>
            <button
              onClick={() => setAuthorTab('coauthors')}
              style={{
                background: authorTab === 'coauthors' ? '#E6E0D0' : 'none',
                border: `1px solid ${authorTab === 'coauthors' ? '#B08A00' : '#E6E0D0'}`,
                borderRadius: 6,
                color: authorTab === 'coauthors' ? '#7A5C00' : '#6E6858',
                padding: '6px 16px',
                fontSize: 13,
                cursor: 'pointer',
                fontWeight: 500
              }}
            >
              👥 Frequent Co-Authors ({authorResult.co_authors?.length || 0})
            </button>
            <button
              onClick={() => setAuthorTab('graph')}
              style={{
                background: authorTab === 'graph' ? '#E6E0D0' : 'none',
                border: `1px solid ${authorTab === 'graph' ? '#1E4FA0' : '#E6E0D0'}`,
                borderRadius: 6,
                color: authorTab === 'graph' ? '#1E4FA0' : '#6E6858',
                padding: '6px 16px',
                fontSize: 13,
                cursor: 'pointer',
                fontWeight: 500
              }}
            >
              🕸️ Collaboration Graph
            </button>

            {authorTab === 'papers' && (
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6E6858' }}>
                <span>Sort by:</span>
                <button
                  onClick={() => setAuthorSort('citations')}
                  style={{
                    background: authorSort === 'citations' ? '#E6E0D0' : 'none',
                    border: '1px solid #D9D2BE',
                    color: authorSort === 'citations' ? '#1E4FA0' : '#6E6858',
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
                    background: authorSort === 'year' ? '#E6E0D0' : 'none',
                    border: '1px solid #D9D2BE',
                    color: authorSort === 'year' ? '#1E4FA0' : '#6E6858',
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
                <div style={{ textAlign: 'center', padding: 40, color: '#8A8375' }}>
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
                    background: '#FAF6EC',
                    border: '1px solid #E6E0D0',
                    borderRadius: 8,
                    padding: 14,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, color: '#2B3A55', fontSize: 14 }}>
                      👤 {toText(ca.name)}
                    </div>
                    <div style={{ fontSize: 12, color: '#6E6858', marginTop: 2 }}>
                      {toText(ca.collaborations)} joint publications
                    </div>
                  </div>
                  <button
                    onClick={() => handleAuthorClick(ca.name)}
                    style={{
                      background: 'rgba(107,63,160,0.15)',
                      border: '1px solid rgba(107,63,160,0.3)',
                      color: '#7A4FB8',
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
            <div style={{ background: '#FAF6EC', border: '1px solid #E6E0D0', borderRadius: 8, padding: 16 }}>
              <div style={{ display: 'flex', gap: 16, marginBottom: 10, fontSize: 12, color: '#6E6858' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#B08A00', boxShadow: '0 0 0 2px #ffffff' }}></span>
                  Researcher (Gold, white ring)
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#6E6858' }}></span>
                  Authored Papers (Gray)
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#B08A00' }}></span>
                  Co-Authors (Gold)
                </span>
              </div>
              {authorResult.graph?.nodes?.length > 1 ? (
                <Graph data={authorResult.graph} height={500} />
              ) : (
                <div style={{ textAlign: 'center', padding: 40, color: '#8A8375' }}>
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
            style={{ background: '#FAF6EC', border: '1px solid #D9D2BE', borderRadius: 8, padding: 20, width: 'min(340px, calc(100vw - 32px))', display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
            <h3 style={{ fontSize: 15 }}>Export Subgraph</h3>
            <p style={{ color: '#6E6858', fontSize: 12 }}>
              Seeds: papers found for "{searchedQuery}" · {depth}-hop traversal
            </p>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, color: '#6E6858' }}>
              What to export
              <select value={exportScope} onChange={e => setExportScope(e.target.value)} style={selectStyle}>
                <option value="citations">Citation paths</option>
                <option value="authors">Author network</option>
                <option value="topic">Whole topic subgraph</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, color: '#6E6858' }}>
              Format
              <select value={exportFormat} onChange={e => setExportFormat(e.target.value)} style={selectStyle}>
                <option value="json">JSON (nodes + links)</option>
                <option value="csv:edges">CSV edge list</option>
                <option value="csv:nodes">CSV node table</option>
              </select>
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button onClick={() => setShowExport(false)}
                style={{ background: 'none', border: '1px solid #D9D2BE', borderRadius: 6, color: '#6E6858', padding: '6px 14px', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={downloadExport}
                style={{ background: '#1E4FA0', border: 'none', borderRadius: 6, color: '#FFFFFF', fontWeight: 600, padding: '6px 14px', cursor: 'pointer' }}>
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

const selectStyle = { background: '#FFFFFF', border: '1px solid #D9D2BE', borderRadius: 6, color: '#2B3A55', padding: '6px 8px', fontSize: 13 }
