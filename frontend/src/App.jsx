import React, { useState, useEffect, createContext, useContext } from 'react'
import { api } from './services/api'
import ErrorBoundary from './components/ErrorBoundary'
import Discover from './pages/Discover'
import Review from './pages/Review'
import Survey from './pages/Survey'
import Gaps from './pages/Gaps'
import Compare from './pages/Compare'
import Chat from './pages/Chat'
import Roadmap from './pages/Roadmap'
import History from './pages/History'
import Analytics from './pages/Analytics'
import GraphAnalytics from './pages/GraphAnalytics'

// Shared context so any tab can read/write the global topic
export const TopicContext = createContext({ topic: '', setTopic: () => {} })
export const useTopicContext = () => useContext(TopicContext)

// Topic input for a tab: follows the header topic until the user types in the
// tab's own field. commit() publishes a value to the header and resumes following.
export function useTopicField() {
  const { topic: globalTopic, setTopic: setGlobalTopic } = useTopicContext()
  const [local, setLocal] = useState('')
  const [edited, setEdited] = useState(false)
  const value = edited ? local : globalTopic
  const edit = v => { setLocal(v); setEdited(true) }
  const commit = v => { setGlobalTopic(v); setLocal(v); setEdited(false) }
  return [value, edit, commit]
}

const TABS = [
  { id: 'discover', label: '🔍 Discover' },
  { id: 'graph',    label: '🕸️ Graph Intel' },
  { id: 'review',   label: '📖 Review' },
  { id: 'survey',   label: '📚 Survey' },
  { id: 'gaps',     label: '💡 Gaps' },
  { id: 'compare',  label: '⚖️ Compare' },
  { id: 'chat',     label: '💬 Chat' },
  { id: 'roadmap',  label: '🗺️ Roadmap' },
  { id: 'history',  label: '🗂️ History' },
  { id: 'analytics', label: '📊 Analytics' },
]

function StatusBadge({ label, connected, title, color }) {
  return (
    <span
      title={title}
      style={{
        fontSize: 11, padding: '2px 8px', borderRadius: 12,
        display: 'flex', alignItems: 'center', gap: 4, cursor: 'help', whiteSpace: 'nowrap',
        background: connected ? `${color}1f` : 'rgba(139,148,158,0.12)',
        color: connected ? color : '#8b949e',
        border: `1px solid ${connected ? `${color}4d` : 'rgba(139,148,158,0.25)'}`,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: connected ? color : '#8b949e', display: 'inline-block' }} />
      {label} {connected ? 'Active' : 'Offline'}
    </span>
  )
}

const n = v => (Number(v) || 0).toLocaleString()

function neo4jTitle(info) {
  const where = info.uri ? ` (${info.uri})` : ''
  if (!info.connected) return `Neo4j offline${where}, graph features use the in-memory fallback`
  const s = info.stats || {}
  return `Neo4j graph store active${where}\nPapers: ${n(s.papers)}, Authors: ${n(s.authors)}, Topics: ${n(s.topics)}\n` +
    `Repositories: ${n(s.repositories)}, Models: ${n(s.models)}, Datasets: ${n(s.datasets)}\nRelationships: ${n(s.relationships)}`
}

function mongoTitle(info) {
  // the Mongo status does not always carry a URI, so only show what is there
  const where = [info.db, info.host].filter(Boolean).join(' @ ')
  if (!info.connected) return `MongoDB offline${where ? ` (${where})` : ''}`
  const s = info.stats || {}
  return `MongoDB document store active${where ? ` (${where})` : ''}\n` +
    `Papers: ${n(s.papers)}, Searches: ${n(s.searches)}, Reports: ${n(s.reports)}, Chat messages: ${n(s.chat_messages)}`
}

export default function App() {
  const [tab, setTab] = useState('discover')
  const [topic, setTopic] = useState('')
  const [neo4jInfo, setNeo4jInfo] = useState(null)
  const [mongoInfo, setMongoInfo] = useState(null)

  useEffect(() => {
    api.neo4jStatus().then(setNeo4jInfo).catch(() => setNeo4jInfo({ connected: false }))
    api.mongoStatus().then(setMongoInfo).catch(() => setMongoInfo({ connected: false }))
  }, [])

  return (
    <TopicContext.Provider value={{ topic, setTopic }}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        {/* Header */}
        <header style={{
          background: '#0d1117', borderBottom: '1px solid #21262d',
          padding: '0 16px', height: 50, display: 'flex', alignItems: 'center',
          gap: 12, flexShrink: 0, zIndex: 100,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: '#58a6ff' }}>
              ⚗️ ResearchIQ
            </span>
            {neo4jInfo && <StatusBadge label="Neo4j" connected={!!neo4jInfo.connected} title={neo4jTitle(neo4jInfo)} color="#3fb950" />}
            {mongoInfo && <StatusBadge label="Mongo" connected={!!mongoInfo.connected} title={mongoTitle(mongoInfo)} color="#10b981" />}
          </div>

          {/* Global topic bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, maxWidth: 420 }}>
            <input
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="Enter a research topic here…"
              style={{
                flex: 1, background: '#161b22', border: '1px solid #30363d',
                borderRadius: 6, color: '#e6edf3', padding: '5px 10px',
                fontSize: 13, outline: 'none',
              }}
              onFocus={e => e.target.style.borderColor = '#58a6ff'}
              onBlur={e => e.target.style.borderColor = '#30363d'}
            />
            {topic && (
              <button
                onClick={() => setTopic('')}
                style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: 14, padding: '2px 4px' }}
                title="Clear topic"
              >✕</button>
            )}
          </div>

          <nav style={{ display: 'flex', gap: 1, overflowX: 'auto' }}>
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)} style={{
                background: tab === t.id ? '#161b22' : 'none',
                border: 'none',
                borderBottom: tab === t.id ? '2px solid #58a6ff' : '2px solid transparent',
                color: tab === t.id ? '#58a6ff' : '#8b949e',
                padding: '6px 11px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                whiteSpace: 'nowrap', cursor: 'pointer', transition: 'all .15s',
              }}>
                {t.label}
              </button>
            ))}
          </nav>
        </header>

        {/* Pages — all mounted, just show/hide to preserve state */}
        <main style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          {[
            ['discover', <Discover />],
            ['graph',    <GraphAnalytics />],
            ['review',   <Review />],
            ['survey',   <Survey />],
            ['gaps',     <Gaps />],
            ['compare',  <Compare />],
            ['chat',     <Chat />],
            ['roadmap',  <Roadmap />],
            ['history',  <History active={tab === 'history'} />],
            ['analytics', <Analytics />],
          ].map(([id, page]) => (
            <div key={id} style={{
              position: 'absolute', inset: 0,
              display: tab === id ? 'block' : 'none',
              overflow: 'hidden',
            }}>
              <ErrorBoundary name={id}>{page}</ErrorBoundary>
            </div>
          ))}
        </main>
      </div>
    </TopicContext.Provider>
  )
}
