import React, { useState, useEffect, useRef } from 'react'
import { api } from '../services/api'
import Graph from '../components/Graph'
import Spinner from '../components/Spinner'
import { toText, asArray } from '../utils/safe'

const METRICS = [
  { id: 'pagerank', label: '📊 PageRank (Prestige)', desc: 'Measures recursive influence: papers cited by other high-impact papers' },
  { id: 'betweenness', label: '🌉 Betweenness (Bridge Papers)', desc: 'Identifies cornerstone papers bridging distinct sub-fields' },
  { id: 'degree', label: '📈 Degree (Direct Citations)', desc: 'Raw citation density in the active graph' },
  { id: 'authority', label: '🏛️ HITS Authority', desc: 'Identifies foundational literature cited by comprehensive surveys' },
]

// metric id in the UI -> field name in /api/graph/analytics results
const METRIC_KEY = {
  pagerank: 'pagerank',
  betweenness: 'betweenness',
  degree: 'degree_centrality',
  authority: 'authority_score',
}

const num = v => (typeof v === 'number' && isFinite(v) ? v : Number(v) || 0)

export default function GraphAnalytics() {
  const [metric, setMetric] = useState('pagerank')
  const [topic, setTopic] = useState('')
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [data, setData] = useState(null)
  const [leaderboardTab, setLeaderboardTab] = useState('papers') // 'papers' | 'authors'
  const [selectedPaper, setSelectedPaper] = useState(null)
  const [notice, setNotice] = useState('')
  const reqId = useRef(0)
  const syncTimer = useRef()

  useEffect(() => {
    fetchAnalytics()
  }, [metric])

  useEffect(() => () => clearTimeout(syncTimer.current), [])

  async function fetchAnalytics(targetTopic) {
    // only the newest request may update the page (metric clicks can overlap)
    const id = ++reqId.current
    setLoading(true)
    const t = targetTopic !== undefined ? targetTopic : topic
    try {
      const res = await api.graphAnalytics({ topic: t || undefined, metric, limit: 30 })
      if (id !== reqId.current) return
      if (res?.success) {
        setData(res)
        setNotice('')
        setSelectedPaper(res.influential_papers?.[0] || null)
      } else {
        // topic not found or Neo4j offline: do not keep showing the previous result
        setData(null)
        setSelectedPaper(null)
        setNotice(toText(res?.message) || 'No graph analytics available for this filter.')
      }
    } catch (e) {
      if (id !== reqId.current) return
      setData(null)
      setSelectedPaper(null)
      setNotice(`Could not load graph analytics: ${e.message}`)
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }

  async function handleSyncToNeo4j() {
    setSyncing(true)
    setSyncMsg('')
    try {
      const res = await api.graphSyncMetrics()
      if (res?.success) {
        setSyncMsg(`✅ ${toText(res.message)}`)
      } else {
        setSyncMsg(`⚠️ ${toText(res?.error || res?.message) || 'Sync failed'}`)
      }
    } catch (e) {
      setSyncMsg(`❌ Sync error: ${e.message}`)
    } finally {
      setSyncing(false)
      clearTimeout(syncTimer.current)
      syncTimer.current = setTimeout(() => setSyncMsg(''), 6000)
    }
  }

  const topology = data?.topology || { total_nodes: 0, total_edges: 0, density: 0, num_communities: 0 }
  const papers = asArray(data?.influential_papers)
  const authors = asArray(data?.influential_authors)
  const metricKey = METRIC_KEY[metric] || 'pagerank'
  const maxScore = Math.max(0.001, ...papers.map(p => num(p[metricKey])))
  const maxAuthorScore = Math.max(0.001, ...authors.map(a => num(a.score)))

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg)' }}>
      {/* Top Header Bar */}
      <div style={{
        padding: '14px 20px', borderBottom: '1px solid var(--border)', background: 'var(--panel)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, gap: 16
      }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>🕸️ Neo4j Graph Intelligence & Centrality</span>
            <span style={{
              background: 'rgba(63,185,80,0.15)', color: 'var(--green)', border: '1px solid rgba(63,185,80,0.3)',
              fontSize: 10, padding: '2px 7px', borderRadius: 10, fontWeight: 600
            }}>
              PageRank Active
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            Detect recursive influence, bridge papers, and authoritative researcher networks across Neo4j AuraDB.
          </div>
        </div>

        {/* Sync to Neo4j Button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {syncMsg && (
            <span style={{ fontSize: 11, color: syncMsg.startsWith('✅') ? 'var(--green)' : 'var(--red)', fontWeight: 500 }}>
              {syncMsg}
            </span>
          )}
          <button
            onClick={handleSyncToNeo4j}
            disabled={syncing}
            style={{
              background: syncing ? 'var(--panel2)' : 'linear-gradient(135deg, #238636 0%, #2ea043 100%)',
              color: '#fff', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6,
              padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: syncing ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 6, transition: 'all .15s', boxShadow: '0 2px 6px rgba(0,0,0,0.3)'
            }}
          >
            {syncing ? <Spinner /> : '⚡'}
            <span>{syncing ? 'Writing to Neo4j…' : 'Sync Metrics to Neo4j'}</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Row */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12,
        padding: '12px 20px', background: 'var(--panel2)', borderBottom: '1px solid var(--border)', flexShrink: 0
      }}>
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Total Papers (Nodes)</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--accent)', marginTop: 2 }}>
            📄 {topology.total_nodes}
          </div>
        </div>
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Citation Links (Edges)</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#bc8cff', marginTop: 2 }}>
            🔗 {topology.total_edges}
          </div>
        </div>
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Research Clusters</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#e3b341', marginTop: 2 }}>
            🧬 {topology.num_communities} Communities
          </div>
        </div>
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Network Density</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--green)', marginTop: 2 }}>
            🌐 {topology.density}
          </div>
        </div>
      </div>

      {/* Control Bar: Metric Selector & Filter */}
      <div style={{
        padding: '10px 20px', background: 'var(--panel)', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexShrink: 0
      }}>
        {/* Metric Selector Pills */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {METRICS.map(m => (
            <button
              key={m.id}
              onClick={() => setMetric(m.id)}
              title={m.desc}
              style={{
                background: metric === m.id ? 'var(--accent)' : 'var(--panel2)',
                color: metric === m.id ? '#000' : 'var(--muted2)',
                border: `1px solid ${metric === m.id ? 'var(--accent)' : 'var(--border)'}`,
                borderRadius: 20, padding: '5px 12px', fontSize: 11, fontWeight: 600,
                cursor: 'pointer', transition: 'all .15s'
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Filter Input */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            value={topic}
            onChange={e => setTopic(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && fetchAnalytics()}
            placeholder="Filter by topic (leave blank for all)..."
            style={{
              background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6,
              color: 'var(--text)', padding: '5px 10px', fontSize: 11, width: 220, outline: 'none'
            }}
          />
          <button
            onClick={() => fetchAnalytics()}
            style={{
              background: 'var(--accent)', color: '#000', border: 'none',
              borderRadius: 6, padding: '5px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer'
            }}
          >
            Apply
          </button>
          {topic && (
            <button
              onClick={() => { setTopic(''); fetchAnalytics('') }}
              style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 11, cursor: 'pointer' }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area: Split View */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* Left Side: Dynamic D3 Graph View */}
        <div style={{ flex: '1 1 58%', display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)', background: 'var(--bg)', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>🕸️ Citation Topology & Prestige Map</span>
              <span style={{ fontSize: 10, color: 'var(--muted)' }}>(Node size ∝ PageRank)</span>
            </span>
            <span style={{ fontSize: 10, color: 'var(--muted2)' }}>Hover a node for details, click to open it</span>
          </div>

          <div style={{ flex: 1, minHeight: 0, position: 'relative', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)' }}>
            {loading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 10 }}>
                <Spinner />
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>Computing {metric} across citation network…</span>
              </div>
            ) : data?.graph?.nodes?.length > 0 ? (
              <Graph data={data.graph} height={520} />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--muted)', padding: 20, textAlign: 'center' }}>
                {notice || 'No citation graph data available.'}
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Leaderboards & Selected Paper Inspector */}
        <div style={{ flex: '1 1 42%', display: 'flex', flexDirection: 'column', background: 'var(--panel)', overflow: 'hidden' }}>
          {/* Leaderboard Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', background: 'var(--panel2)' }}>
            <button
              onClick={() => setLeaderboardTab('papers')}
              style={{
                flex: 1, padding: '10px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                background: leaderboardTab === 'papers' ? 'var(--panel)' : 'transparent',
                color: leaderboardTab === 'papers' ? 'var(--accent)' : 'var(--muted)',
                borderBottom: leaderboardTab === 'papers' ? '2px solid var(--accent)' : 'none'
              }}
            >
              📄 Top Influential Papers ({papers.length})
            </button>
            <button
              onClick={() => setLeaderboardTab('authors')}
              style={{
                flex: 1, padding: '10px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
                background: leaderboardTab === 'authors' ? 'var(--panel)' : 'transparent',
                color: leaderboardTab === 'authors' ? '#e3b341' : 'var(--muted)',
                borderBottom: leaderboardTab === 'authors' ? '2px solid #e3b341' : 'none'
              }}
            >
              👨‍🔬 Influential Researchers ({authors.length})
            </button>
          </div>

          {/* List Content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {leaderboardTab === 'papers' ? (
              papers.map((p, idx) => {
                const score = num(p[metricKey])
                const pct = Math.min(100, Math.max(5, (score / maxScore) * 100))
                const isSelected = selectedPaper?.title === p.title

                return (
                  <div
                    key={idx}
                    onClick={() => setSelectedPaper(p)}
                    style={{
                      background: isSelected ? 'rgba(88,166,255,0.08)' : 'var(--panel2)',
                      border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: 8, padding: 10, cursor: 'pointer', transition: 'all .15s'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{
                          background: idx < 3 ? 'var(--accent)' : 'var(--border)',
                          color: idx < 3 ? '#000' : 'var(--muted)',
                          fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '1px 5px', minWidth: 22, textAlign: 'center'
                        }}>
                          #{idx + 1}
                        </span>
                        <span style={{
                          fontSize: 12, fontWeight: 600, color: 'var(--text)', lineHeight: 1.4,
                          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
                        }}>
                          {p.title}
                        </span>
                      </div>

                      <span style={{
                        background: 'rgba(88,166,255,0.15)', color: 'var(--accent)',
                        fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, whiteSpace: 'nowrap'
                      }}>
                        {score.toFixed(4)}
                      </span>
                    </div>

                    {/* Progress Bar for Score */}
                    <div style={{ width: '100%', height: 4, background: 'var(--border)', borderRadius: 2, margin: '6px 0', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', borderRadius: 2 }} />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)' }}>
                      <span>
                        {p.year ? `📅 ${p.year} • ` : ''}
                        👥 {p.authors?.slice(0, 2).join(', ') || 'Various'}{p.authors?.length > 2 ? ' et al.' : ''}
                      </span>
                      <span>
                        🧬 Cluster {p.community}
                      </span>
                    </div>
                  </div>
                )
              })
            ) : (
              authors.map((a, idx) => {
                const pct = Math.min(100, Math.max(5, (num(a.score) / maxAuthorScore) * 100))

                return (
                  <div
                    key={idx}
                    style={{
                      background: 'var(--panel2)', border: '1px solid var(--border)',
                      borderRadius: 8, padding: 10
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{
                          background: idx < 3 ? '#e3b341' : 'var(--border)',
                          color: idx < 3 ? '#000' : 'var(--muted)',
                          fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '1px 5px', minWidth: 22, textAlign: 'center'
                        }}>
                          #{idx + 1}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                          {a.name}
                        </span>
                      </div>
                      <span style={{ background: 'rgba(227,179,65,0.15)', color: '#e3b341', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4 }}>
                        Prestige: {num(a.score).toFixed(4)}
                      </span>
                    </div>

                    <div style={{ width: '100%', height: 4, background: 'var(--border)', borderRadius: 2, margin: '6px 0', overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: '#e3b341', borderRadius: 2 }} />
                    </div>

                    <div style={{ fontSize: 10, color: 'var(--muted)', display: 'flex', justifyContent: 'space-between' }}>
                      <span>📚 {a.papers_count} paper{a.papers_count > 1 ? 's' : ''} in knowledge graph</span>
                      <span style={{ maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.top_paper}>
                        Top: {a.top_paper}
                      </span>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
