import React, { useState, useRef } from 'react'
import { api } from '../services/api'
import { useTopicField } from '../App'
import PaperCard from '../components/PaperCard'
import Graph from '../components/Graph'
import Spinner from '../components/Spinner'
import RepoList from '../components/RepoList'
import CitationModal from '../components/CitationModal'
import { ModelCard, DatasetCard } from '../components/HFArtifacts'
import { safeHttpUrl, toText, asArray } from '../utils/safe'

export default function Discover() {
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
  const [showGraph, setShowGraph]   = useState(true)
  const [activeTab, setActiveTab]   = useState('papers') // 'papers' | 'models' | 'datasets' | 'repos'

  // Neo4j citation subgraph (depth slider) and export
  const [depth, setDepth]       = useState(1)
  const [subgraph, setSubgraph] = useState(null)   // neo4j subgraph, replaces the search graph once loaded
  const [graphLoading, setGraphLoading] = useState(false)
  const [showExport, setShowExport] = useState(false)
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
    setDepth(d); setGraphLoading(true)
    try {
      const r = await fetch(`/api/graph/export/json?scope=topic&topic=${encodeURIComponent(searchedQuery)}&depth=${d}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      if (id === subgraphReq.current) setSubgraph(data)
    } catch (e) {
      if (id === subgraphReq.current) setError(`Could not load ${d}-hop subgraph: ${e.message}`)
    } finally {
      // a newer slider move owns the loading flag
      if (id === subgraphReq.current) setGraphLoading(false)
    }
  }

  function resetSubgraph() {
    subgraphReq.current++
    setSubgraph(null); setGraphLoading(false); setDepth(1)
  }

  function downloadExport() {
    const [fmt, table] = exportFormat.split(':')
    let url = `/api/graph/export/${fmt}?scope=${exportScope}&topic=${encodeURIComponent(searchedQuery)}&depth=${depth}`
    if (table) url += `&table=${table}`
    const a = document.createElement('a')
    a.href = url
    a.click()
    setShowExport(false)
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
      setResult(await api.search(q, sources, 12))
      setSearchedQuery(q)
      // new result: drop any subgraph (and in-flight subgraph request) and reset depth
      resetSubgraph()
      setActiveTab('papers')
    } catch (e) { setError(e.message) }
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
      <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: 20, flexShrink: 0 }}>
        
        {/* Mode Toggle Pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <button
            type="button"
            onClick={() => setSearchMode('topic')}
            style={{
              background: searchMode === 'topic' ? '#1f6feb' : '#21262d',
              border: `1px solid ${searchMode === 'topic' ? '#388bfd' : '#30363d'}`,
              color: searchMode === 'topic' ? '#ffffff' : '#8b949e',
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
              background: searchMode === 'author' ? '#8957e5' : '#21262d',
              border: `1px solid ${searchMode === 'author' ? '#a371f7' : '#30363d'}`,
              color: searchMode === 'author' ? '#ffffff' : '#8b949e',
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
            <h2 style={{ fontSize: 16, marginBottom: 4 }}>🔍 Research Paper Discovery</h2>
            <p style={{ color: '#8b949e', fontSize: 13, marginBottom: 14 }}>
              Search papers from ArXiv &amp; Semantic Scholar, view citations, and explore GitHub, HF models &amp; datasets.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                value={query} onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && searchTopic()}
                placeholder="e.g. LoRA fine-tuning PEFT, deepseek reasoning, graph neural networks"
                style={{ flex: 1, minWidth: 260, background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, color: '#e6edf3', padding: '8px 12px', fontSize: 14, outline: 'none' }}
                onFocus={e => e.target.style.borderColor = '#58a6ff'}
                onBlur={e => e.target.style.borderColor = '#30363d'}
              />
              <div style={{ display: 'flex', gap: 14, fontSize: 13, color: '#8b949e' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={arxiv} onChange={e => setArxiv(e.target.checked)} style={{ accentColor: '#58a6ff' }} /> ArXiv
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                  <input type="checkbox" checked={scholar} onChange={e => setScholar(e.target.checked)} style={{ accentColor: '#58a6ff' }} /> Scholar
                </label>
                <span style={{ color: '#3fb950', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                  🔧 GitHub <span style={{ color: '#6e7681' }}>(auto)</span>
                </span>
              </div>
              <button onClick={searchTopic} disabled={loading || !query.trim()}
                style={{ background: loading ? '#21262d' : '#58a6ff', color: loading ? '#8b949e' : '#000', border: 'none', borderRadius: 6, padding: '8px 22px', fontWeight: 600, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer' }}>
                {loading ? <><Spinner />Searching…</> : 'Search'}
              </button>
            </div>
            {error && <div style={{ marginTop: 10, color: '#f85149', fontSize: 13, background: 'rgba(248,81,73,.08)', padding: '8px 12px', borderRadius: 6 }}>⚠️ {error}</div>}
          </div>
        )}

        {/* ── Mode B: Author Search ───────────────────────────────────────── */}
        {searchMode === 'author' && (
          <div>
            <h2 style={{ fontSize: 16, marginBottom: 4, color: '#d2a8ff' }}>👤 Author &amp; Researcher Portfolio Search</h2>
            <p style={{ color: '#8b949e', fontSize: 13, marginBottom: 12 }}>
              Find all research papers authored by a researcher, their citation metrics, h-index, affiliations, and co-authors.
            </p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                value={authorQuery} onChange={e => setAuthorQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && searchAuthor()}
                placeholder="e.g. Geoffrey Hinton, Yann LeCun, Ashish Vaswani, Yoshua Bengio, Fei-Fei Li"
                style={{ flex: 1, minWidth: 260, background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, color: '#e6edf3', padding: '8px 12px', fontSize: 14, outline: 'none' }}
                onFocus={e => e.target.style.borderColor = '#bc8cff'}
                onBlur={e => e.target.style.borderColor = '#30363d'}
              />
              <button onClick={() => searchAuthor()} disabled={authorLoading || !authorQuery.trim()}
                style={{ background: authorLoading ? '#21262d' : '#8957e5', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 22px', fontWeight: 600, fontSize: 14, cursor: authorLoading ? 'not-allowed' : 'pointer' }}>
                {authorLoading ? <><Spinner />Searching Author…</> : 'Search Author'}
              </button>
            </div>

            {/* Quick Author Suggestion Chips */}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: '#6e7681' }}>Try:</span>
              {['Ashish Vaswani', 'Geoffrey Hinton', 'Yann LeCun', 'Andrew Ng', 'Yoshua Bengio'].map((name, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => searchAuthor(name)}
                  style={{
                    background: 'none',
                    border: '1px solid #30363d',
                    borderRadius: 14,
                    color: '#8b949e',
                    fontSize: 11,
                    padding: '2px 10px',
                    cursor: 'pointer'
                  }}
                  onMouseEnter={e => { e.target.style.color = '#c9d1d9'; e.target.style.borderColor = '#58a6ff' }}
                  onMouseLeave={e => { e.target.style.color = '#8b949e'; e.target.style.borderColor = '#30363d' }}
                >
                  {name}
                </button>
              ))}
            </div>

            {authorError && <div style={{ marginTop: 10, color: '#f85149', fontSize: 13, background: 'rgba(248,81,73,.08)', padding: '8px 12px', borderRadius: 6 }}>⚠️ {authorError}</div>}
          </div>
        )}

      </div>

      {/* ── Mode A Results: Topic Search View ─────────────────────────────── */}
      {searchMode === 'topic' && result && (
        <>
          {/* Stats + tab bar */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
            <button onClick={() => setActiveTab('papers')}
              style={{ background: activeTab === 'papers' ? '#21262d' : 'none', border: `1px solid ${activeTab === 'papers' ? '#58a6ff' : '#21262d'}`, borderRadius: 6, color: activeTab === 'papers' ? '#58a6ff' : '#8b949e', padding: '5px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
              📄 Papers ({result.total})
            </button>
            <button onClick={() => setActiveTab('models')}
              style={{ background: activeTab === 'models' ? '#21262d' : 'none', border: `1px solid ${activeTab === 'models' ? '#ff9d00' : '#21262d'}`, borderRadius: 6, color: activeTab === 'models' ? '#ff9d00' : '#8b949e', padding: '5px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
              🤗 HF Models ({result.models?.length || 0})
            </button>
            <button onClick={() => setActiveTab('datasets')}
              style={{ background: activeTab === 'datasets' ? '#21262d' : 'none', border: `1px solid ${activeTab === 'datasets' ? '#00b4d8' : '#21262d'}`, borderRadius: 6, color: activeTab === 'datasets' ? '#00b4d8' : '#8b949e', padding: '5px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
              📊 Datasets ({result.datasets?.length || 0})
            </button>
            <button onClick={() => setActiveTab('repos')}
              style={{ background: activeTab === 'repos' ? '#21262d' : 'none', border: `1px solid ${activeTab === 'repos' ? '#bc8cff' : '#21262d'}`, borderRadius: 6, color: activeTab === 'repos' ? '#bc8cff' : '#8b949e', padding: '5px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
              🔧 GitHub Repos ({result.repos?.length || 0})
            </button>
            <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 6, padding: '5px 12px', fontSize: 12, color: '#6e7681' }}>
              🧠 {result.rag_count} in RAG
            </div>
            {result.graph_source && (
              <div style={{
                background: result.graph_source === 'neo4j' ? 'rgba(63,185,80,0.1)' : 'rgba(88,166,255,0.1)',
                border: `1px solid ${result.graph_source === 'neo4j' ? 'rgba(63,185,80,0.3)' : 'rgba(88,166,255,0.3)'}`,
                borderRadius: 6, padding: '5px 12px', fontSize: 12,
                color: result.graph_source === 'neo4j' ? '#3fb950' : '#58a6ff'
              }}>
                {result.graph_source === 'neo4j' ? '🌿 Neo4j Graph' : '📊 NetworkX Graph'}
              </div>
            )}
            <button onClick={() => setShowGraph(p => !p)}
              style={{ background: 'none', border: '1px solid #30363d', borderRadius: 6, color: '#8b949e', padding: '5px 12px', fontSize: 12, cursor: 'pointer', marginLeft: 'auto' }}>
              {showGraph ? '⊟ Hide Graph' : '⊞ Show Graph'}
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: showGraph && result.graph ? '1fr 400px' : '1fr', gap: 16, alignItems: 'start' }}>

            {/* Main content */}
            <div>
              {/* Papers tab */}
              {activeTab === 'papers' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ color: '#8b949e', fontSize: 12, padding: '0 4px' }}>
                    💡 <i>Tip: Click any paper or &ldquo;Citations &amp; Network&rdquo; to view incoming citations &amp; references. Click any author to view their full portfolio.</i>
                  </div>
                  {!result.papers?.length
                    ? <div style={{ color: '#6e7681', fontSize: 13, padding: 20, textAlign: 'center' }}>No papers found. Try different keywords.</div>
                    : result.papers.map((p, i) => (
                      <PaperCard
                        key={i}
                        paper={p}
                        onViewCitations={setSelectedCitationPaper}
                        onAuthorClick={handleAuthorClick}
                      />
                    ))
                  }
                </div>
              )}

              {/* Models tab */}
              {activeTab === 'models' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {!result.models?.length ? (
                    <div style={{ color: '#6e7681', fontSize: 13, padding: 20, textAlign: 'center' }}>
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
                    <div style={{ color: '#6e7681', fontSize: 13, padding: 20, textAlign: 'center' }}>
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
              <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: 16, position: 'sticky', top: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <h3 style={{ fontSize: 13, fontWeight: 600 }}>{subgraph ? `Neo4j Subgraph (${subgraph.nodes?.length || 0} nodes)` : 'Knowledge Graph'}</h3>
                  {graphLoading && <Spinner />}
                  {subgraph && (
                    <button onClick={resetSubgraph}
                      style={{ background: 'none', border: 'none', color: '#6e7681', fontSize: 11, cursor: 'pointer', padding: 0 }}>
                      reset
                    </button>
                  )}
                  <button onClick={() => setShowExport(true)}
                    style={{ marginLeft: 'auto', background: 'none', border: '1px solid #30363d', borderRadius: 6, color: '#8b949e', padding: '3px 10px', fontSize: 11, cursor: 'pointer' }}>
                    ⤓ Export Subgraph
                  </button>
                </div>
                <Graph data={subgraph || result.graph} height={480} depth={depth} onDepthChange={loadSubgraph} />
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
            background: 'linear-gradient(180deg, #161b22 0%, #0d1117 100%)',
            border: '1px solid #30363d',
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
                  background: 'linear-gradient(135deg, #8957e5 0%, #e3b341 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 24,
                  boxShadow: '0 4px 12px rgba(137,87,229,0.3)'
                }}>
                  👤
                </div>
                <div>
                  <h2 style={{ fontSize: 20, fontWeight: 700, color: '#f0f6fc', margin: '0 0 4px 0' }}>
                    {toText(authorInfo.name)}
                  </h2>
                  <div style={{ fontSize: 13, color: '#8b949e', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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
                <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '6px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#8b949e', textTransform: 'uppercase', fontWeight: 600 }}>Total Works</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#58a6ff' }}>
                    {authorResult.author?.works_count || authorResult.total_papers || 0}
                  </div>
                </div>
                <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '6px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#8b949e', textTransform: 'uppercase', fontWeight: 600 }}>Citations</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#f85149' }}>
                    {(Number(authorInfo.citation_count) || 0).toLocaleString()}
                  </div>
                </div>
                <div style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: '6px 14px', textAlign: 'center' }}>
                  <div style={{ fontSize: 11, color: '#8b949e', textTransform: 'uppercase', fontWeight: 600 }}>h-index</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#e3b341' }}>
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
                      color: '#a6e22e',
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
                background: authorTab === 'papers' ? '#21262d' : 'none',
                border: `1px solid ${authorTab === 'papers' ? '#8957e5' : '#21262d'}`,
                borderRadius: 6,
                color: authorTab === 'papers' ? '#d2a8ff' : '#8b949e',
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
                background: authorTab === 'coauthors' ? '#21262d' : 'none',
                border: `1px solid ${authorTab === 'coauthors' ? '#e3b341' : '#21262d'}`,
                borderRadius: 6,
                color: authorTab === 'coauthors' ? '#e3b341' : '#8b949e',
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
                background: authorTab === 'graph' ? '#21262d' : 'none',
                border: `1px solid ${authorTab === 'graph' ? '#58a6ff' : '#21262d'}`,
                borderRadius: 6,
                color: authorTab === 'graph' ? '#58a6ff' : '#8b949e',
                padding: '6px 16px',
                fontSize: 13,
                cursor: 'pointer',
                fontWeight: 500
              }}
            >
              🕸️ Collaboration Graph
            </button>

            {authorTab === 'papers' && (
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8b949e' }}>
                <span>Sort by:</span>
                <button
                  onClick={() => setAuthorSort('citations')}
                  style={{
                    background: authorSort === 'citations' ? '#21262d' : 'none',
                    border: '1px solid #30363d',
                    color: authorSort === 'citations' ? '#58a6ff' : '#8b949e',
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
                    background: authorSort === 'year' ? '#21262d' : 'none',
                    border: '1px solid #30363d',
                    color: authorSort === 'year' ? '#58a6ff' : '#8b949e',
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
                <div style={{ textAlign: 'center', padding: 40, color: '#6e7681' }}>
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
                    background: '#161b22',
                    border: '1px solid #21262d',
                    borderRadius: 8,
                    padding: 14,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, color: '#e6edf3', fontSize: 14 }}>
                      👤 {toText(ca.name)}
                    </div>
                    <div style={{ fontSize: 12, color: '#8b949e', marginTop: 2 }}>
                      {toText(ca.collaborations)} joint publications
                    </div>
                  </div>
                  <button
                    onClick={() => handleAuthorClick(ca.name)}
                    style={{
                      background: 'rgba(137,87,229,0.15)',
                      border: '1px solid rgba(137,87,229,0.3)',
                      color: '#d2a8ff',
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
            <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: 16 }}>
              <div style={{ display: 'flex', gap: 16, marginBottom: 10, fontSize: 12, color: '#8b949e' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#e3b341', boxShadow: '0 0 0 2px #ffffff' }}></span>
                  Researcher (Gold, white ring)
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#8b949e' }}></span>
                  Authored Papers (Gray)
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#e3b341' }}></span>
                  Co-Authors (Gold)
                </span>
              </div>
              {authorResult.graph?.nodes?.length > 1 ? (
                <Graph data={authorResult.graph} height={500} />
              ) : (
                <div style={{ textAlign: 'center', padding: 40, color: '#6e7681' }}>
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
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 8, padding: 20, width: 340, display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
            <h3 style={{ fontSize: 15 }}>Export Subgraph</h3>
            <p style={{ color: '#8b949e', fontSize: 12 }}>
              Seeds: papers found for "{searchedQuery}" · {depth}-hop traversal
            </p>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, color: '#8b949e' }}>
              What to export
              <select value={exportScope} onChange={e => setExportScope(e.target.value)} style={selectStyle}>
                <option value="citations">Citation paths</option>
                <option value="authors">Author network</option>
                <option value="topic">Whole topic subgraph</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, color: '#8b949e' }}>
              Format
              <select value={exportFormat} onChange={e => setExportFormat(e.target.value)} style={selectStyle}>
                <option value="json">JSON (nodes + links)</option>
                <option value="csv:edges">CSV edge list</option>
                <option value="csv:nodes">CSV node table</option>
              </select>
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
              <button onClick={() => setShowExport(false)}
                style={{ background: 'none', border: '1px solid #30363d', borderRadius: 6, color: '#8b949e', padding: '6px 14px', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={downloadExport}
                style={{ background: '#58a6ff', border: 'none', borderRadius: 6, color: '#000', fontWeight: 600, padding: '6px 14px', cursor: 'pointer' }}>
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

const selectStyle = { background: '#0d1117', border: '1px solid #30363d', borderRadius: 6, color: '#e6edf3', padding: '6px 8px', fontSize: 13 }
