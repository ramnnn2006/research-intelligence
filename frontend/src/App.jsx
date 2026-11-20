import React, { useState, useEffect, createContext, useContext } from 'react'
import { api } from './services/api'
import ErrorBoundary from './components/ErrorBoundary'
import Landing from './Landing'
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
  { id: 'discover', label: 'Discover' },
  { id: 'graph',    label: 'Graph Intel' },
  { id: 'review',   label: 'Review' },
  { id: 'survey',   label: 'Survey' },
  { id: 'gaps',     label: 'Gaps' },
  { id: 'compare',  label: 'Compare' },
  { id: 'chat',     label: 'Chat' },
  { id: 'roadmap',  label: 'Roadmap' },
  { id: 'history',  label: 'History' },
  { id: 'analytics', label: 'Analytics' },
]

function StatusBadge({ label, connected, title }) {
  const color = connected ? 'var(--green)' : 'var(--muted2)'
  return (
    <span
      title={title}
      style={{
        fontSize: 10.5, padding: '2px 8px', borderRadius: 12,
        display: 'flex', alignItems: 'center', gap: 4, cursor: 'help', whiteSpace: 'nowrap',
        fontFamily: 'var(--serif-body)', letterSpacing: '.04em',
        background: connected ? 'rgba(46,125,70,0.10)' : 'rgba(138,131,117,0.10)',
        color,
        border: `1px solid ${connected ? 'rgba(46,125,70,0.35)' : 'rgba(138,131,117,0.30)'}`,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block' }} />
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
  const [entered, setEntered] = useState(() => {
    try { return sessionStorage.getItem('ri.entered') === '1' } catch { return false }
  })
  const [tab, setTab] = useState('discover')
  const [topic, setTopic] = useState('')
  const [neo4jInfo, setNeo4jInfo] = useState(null)
  const [mongoInfo, setMongoInfo] = useState(null)

  useEffect(() => {
    if (!entered) return
    api.neo4jStatus().then(setNeo4jInfo).catch(() => setNeo4jInfo({ connected: false }))
    api.mongoStatus().then(setMongoInfo).catch(() => setMongoInfo({ connected: false }))
  }, [entered])

  const enter = () => {
    try { sessionStorage.setItem('ri.entered', '1') } catch {}
    setEntered(true)
  }

  if (!entered) return <Landing onEnter={enter} />

  return (
    <TopicContext.Provider value={{ topic, setTopic }}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        {/* Header */}
        <header className="hd">
          <div className="hd-brand">
            <button
              onClick={() => { try { sessionStorage.removeItem('ri.entered') } catch {}; setEntered(false) }}
              title="Back to the cover page"
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
            >
              <span className="hd-word">ResearchIQ</span>
            </button>
            <span className="hd-badges">
              {neo4jInfo && <StatusBadge label="Neo4j" connected={!!neo4jInfo.connected} title={neo4jTitle(neo4jInfo)} />}
              {mongoInfo && <StatusBadge label="Mongo" connected={!!mongoInfo.connected} title={mongoTitle(mongoInfo)} />}
            </span>
          </div>

          {/* Global topic bar */}
          <div className="hd-topic">
            <input
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="Enter a research topic here…"
            />
            {topic && (
              <button onClick={() => setTopic('')} title="Clear topic">✕</button>
            )}
          </div>

          <nav className="hd-tabs">
            {TABS.map((t, i) => (
              <React.Fragment key={t.id}>
                {i > 0 && <span className="hd-sep">/</span>}
                <button className={`hd-tab${tab === t.id ? ' on' : ''}`} onClick={() => setTab(t.id)}>
                  {t.label}
                </button>
              </React.Fragment>
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
