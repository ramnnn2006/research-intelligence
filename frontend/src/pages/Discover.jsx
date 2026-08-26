import React, { useState } from 'react'
import { api } from '../services/api'
import { useTopicContext } from '../App'
import PaperCard from '../components/PaperCard'
import Graph from '../components/Graph'
import Spinner from '../components/Spinner'
import RepoList from '../components/RepoList'

export default function Discover() {
  const { topic: globalTopic, setTopic: setGlobalTopic } = useTopicContext()
  const [query, setQuery]       = useState(globalTopic || '')
  const [arxiv, setArxiv]       = useState(true)
  const [scholar, setScholar]   = useState(true)
  const [loading, setLoading]   = useState(false)
  const [result, setResult]     = useState(null)
  const [error, setError]       = useState('')
  const [showGraph, setShowGraph] = useState(true)
  const [activeTab, setActiveTab] = useState('papers') // 'papers' | 'repos'

  async function search() {
    if (!query.trim() || loading) return
    setGlobalTopic(query)
    setLoading(true); setError('')
    try {
      const sources = []
      if (arxiv)   sources.push('arxiv')
      if (scholar) sources.push('semantic_scholar')
      // GitHub is always fetched server-side regardless
      setResult(await api.search(query, sources, 12))
      setActiveTab('papers')
    } catch (e) { setError(e.message) }
    setLoading(false)
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Search bar */}
      <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 8, padding: 20, flexShrink: 0 }}>
        <h2 style={{ fontSize: 16, marginBottom: 4 }}>🔍 Research Paper Discovery</h2>
        <p style={{ color: '#8b949e', fontSize: 13, marginBottom: 14 }}>
          Search papers from ArXiv &amp; Semantic Scholar and find GitHub implementations automatically
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
            placeholder="e.g. graph neural networks for fraud detection"
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
          <button onClick={search} disabled={loading || !query.trim()}
            style={{ background: loading ? '#21262d' : '#58a6ff', color: loading ? '#8b949e' : '#000', border: 'none', borderRadius: 6, padding: '8px 22px', fontWeight: 600, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer' }}>
            {loading ? <><Spinner />Searching…</> : 'Search'}
          </button>
        </div>
        {error && <div style={{ marginTop: 10, color: '#f85149', fontSize: 13, background: 'rgba(248,81,73,.08)', padding: '8px 12px', borderRadius: 6 }}>⚠️ {error}</div>}
      </div>

      {result && (
        <>
          {/* Stats + tab bar */}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 }}>
            <button onClick={() => setActiveTab('papers')}
              style={{ background: activeTab === 'papers' ? '#21262d' : 'none', border: `1px solid ${activeTab === 'papers' ? '#58a6ff' : '#21262d'}`, borderRadius: 6, color: activeTab === 'papers' ? '#58a6ff' : '#8b949e', padding: '5px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
              📄 Papers ({result.total})
            </button>
            <button onClick={() => setActiveTab('repos')}
              style={{ background: activeTab === 'repos' ? '#21262d' : 'none', border: `1px solid ${activeTab === 'repos' ? '#bc8cff' : '#21262d'}`, borderRadius: 6, color: activeTab === 'repos' ? '#bc8cff' : '#8b949e', padding: '5px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>
              🔧 GitHub Repos ({result.repos?.length || 0})
            </button>
            <div style={{ background: '#161b22', border: '1px solid #21262d', borderRadius: 6, padding: '5px 12px', fontSize: 12, color: '#6e7681' }}>
              🧠 {result.rag_count} in RAG
            </div>
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
                  {result.papers?.length === 0
                    ? <div style={{ color: '#6e7681', fontSize: 13, padding: 20, textAlign: 'center' }}>No papers found. Try different keywords.</div>
                    : result.papers.map((p, i) => <PaperCard key={i} paper={p} />)
                  }
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
                <h3 style={{ fontSize: 13, marginBottom: 10, fontWeight: 600 }}>Knowledge Graph</h3>
                <Graph data={result.graph} height={480} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
