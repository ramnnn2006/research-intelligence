import React, { useState, useEffect, createContext, useContext } from 'react'
import { api } from './services/api'
import ErrorBoundary from './components/ErrorBoundary'
import { ToastProvider } from './components/Toast'
import Landing from './Landing'
import ThemeToggle from './components/ThemeToggle'
import useTheme from './hooks/useTheme'
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

// Memoized page components: App state that pages do not use (drawer, status badges)
// must not re-render ten mounted tabs. Context updates still reach consumers.
const MemoDiscover = React.memo(Discover)
const MemoGraphAnalytics = React.memo(GraphAnalytics)
const MemoReview = React.memo(Review)
const MemoSurvey = React.memo(Survey)
const MemoGaps = React.memo(Gaps)
const MemoCompare = React.memo(Compare)
const MemoChat = React.memo(Chat)
const MemoRoadmap = React.memo(Roadmap)
const MemoHistory = React.memo(History)
const MemoAnalytics = React.memo(Analytics)

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

function StatusBadge({ label, connected, title, showDetail }) {
  const color = connected ? 'var(--green)' : 'var(--muted2)'
  const badge = (
    <span translate="no"
      title={title} tabIndex={0} aria-label={`${label} ${connected ? 'active' : 'offline'}. ${title || ''}`}
      style={{
        fontSize: 10.5, padding: '2px 8px', borderRadius: 12,
        display: 'flex', alignItems: 'center', gap: 4, cursor: 'help', whiteSpace: 'nowrap',
        fontFamily: 'var(--serif-body)', letterSpacing: '.04em',
        background: connected ? 'rgba(var(--green-rgb),0.10)' : 'rgba(138,131,117,0.10)',
        color,
        border: `1px solid ${connected ? 'rgba(var(--green-rgb),0.35)' : 'rgba(138,131,117,0.30)'}`,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {label} {connected ? 'Active' : 'Offline'}
    </span>
  )
  if (!showDetail) return badge
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
      {badge}
      {title && <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.4, maxWidth: 260, whiteSpace: 'pre-line' }}>{title}</span>}
    </span>
  )
}

const n = v => (Number(v) || 0).toLocaleString()

function neo4jTitle(info) {
  const where = info.uri ? ` (${info.uri})` : ''
  if (!info.connected) return 'Neo4j is offline. Metrics cannot be saved and Graph Intel analytics are unavailable. The Discover graph is built separately and still works.'
  const s = info.stats || {}
  return `Neo4j graph store active${where}\nPapers: ${n(s.papers)}, Authors: ${n(s.authors)}, Topics: ${n(s.topics)}\n` +
    `Repositories: ${n(s.repositories)}, Models: ${n(s.models)}, Datasets: ${n(s.datasets)}\nRelationships: ${n(s.relationships)}`
}

function mongoTitle(info) {
  // the Mongo status does not always carry a URI, so only show what is there
  const where = [info.db, info.host].filter(Boolean).join(' @ ')
  if (!info.connected) return 'MongoDB is offline. Features that store data in it, such as saved history, are unavailable until it is reachable.'
  const s = info.stats || {}
  return `MongoDB document store active${where ? ` (${where})` : ''}\n` +
    `Papers: ${n(s.papers)}, Searches: ${n(s.searches)}, Reports: ${n(s.reports)}, Chat messages: ${n(s.chat_messages)}`
}

export default function App() {
  const [theme, toggleTheme] = useTheme()
  const [entered, setEntered] = useState(() => {
    try { return sessionStorage.getItem('ri.entered') === '1' } catch { return false }
  })
  const TAB_IDS = TABS.map(t => t.id)
  const [tab, setTab] = useState(() => {
    const h = (typeof location !== 'undefined' ? location.hash : '').replace('#', '').split('?')[0]
    return TAB_IDS.includes(h) ? h : 'discover'
  })
  const [topic, setTopic] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const menuBtn = React.useRef(null)
  const [neo4jInfo, setNeo4jInfo] = useState(null)
  const [mongoInfo, setMongoInfo] = useState(null)

  useEffect(() => {
    if (!entered) return
    api.neo4jStatus().then(setNeo4jInfo).catch(() => setNeo4jInfo({ connected: false }))
    api.mongoStatus().then(setMongoInfo).catch(() => setMongoInfo({ connected: false }))
  }, [entered])

  const firstSync = React.useRef(true)
  // remember the open tab across refreshes and name it in the browser tab title
  useEffect(() => {
    if (!entered) { document.title = 'ResearchIQ'; return }
    const label = TABS.find(t => t.id === tab)?.label || ''
    document.title = `${label} · ResearchIQ`
    const cur = location.hash.replace('#', '')
    const [curTab, curQuery] = cur.split('?')
    if (curTab !== tab || ((tab !== 'discover' && tab !== 'history') && curQuery)) {
      const keep = (tab === 'discover' || tab === 'history') && curQuery ? `?${curQuery}` : ''
      if (firstSync.current) history.replaceState(null, '', `#${tab}${keep}`)
      else history.pushState(null, '', `#${tab}${keep}`)
    }
    firstSync.current = false
  }, [tab, entered])

  // browser back/forward or a hand-edited hash switches the page
  useEffect(() => {
    function onHash() {
      const h = location.hash.replace('#', '').split('?')[0]
      if (TAB_IDS.includes(h)) setTab(h)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // phone drawer: focus moves in on open, Tab stays inside, Escape closes and returns focus
  const navRef = React.useRef(null)
  useEffect(() => {
    if (!menuOpen) return
    const nav = navRef.current
    const focusables = () => [...nav.querySelectorAll('button')]
    ;(nav.querySelector('.hd-tab.on') || focusables()[0])?.focus()
    const onKey = e => {
      if (e.key === 'Escape') { setMenuOpen(false); menuBtn.current?.focus(); return }
      if (e.key !== 'Tab') return
      const f = focusables()
      if (!f.length) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  // leaving the phone breakpoint with the drawer open would strand it
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 761px)')
    const on = () => { if (mq.matches) setMenuOpen(false) }
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  const enter = () => {
    try { sessionStorage.setItem('ri.entered', '1') } catch {}
    setEntered(true)
  }

  // a stable value: drawer or badge updates do not re-render every context consumer
  const topicValue = React.useMemo(() => ({ topic, setTopic }), [topic])

  const themeFooter = <footer className="ri-theme-footer"><ThemeToggle theme={theme} onToggle={toggleTheme} /></footer>
  if (!entered) return <div className="ri-cover-shell"><Landing onEnter={enter} />{themeFooter}</div>

  return (
    <TopicContext.Provider value={topicValue}>
      <ToastProvider tab={tab} setTab={setTab}>
      <div className="ri-shell" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <a className="ri-skip" href="#ri-main">Skip to content</a>
        <h1 className="ri-sr-only">ResearchIQ — {TABS.find(t => t.id === tab)?.label || 'Discover'}</h1>
        {/* Header */}
        <header className="hd">
          <div className="hd-brand">
            <button
              onClick={() => { try { sessionStorage.removeItem('ri.entered') } catch {}; setEntered(false) }}
              title="Back to the cover page"
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
            >
              <span className="hd-word" translate="no">ResearchIQ</span>
            </button>
            <span className="hd-badges">
              {neo4jInfo && <StatusBadge label="Neo4j" connected={!!neo4jInfo.connected} title={neo4jTitle(neo4jInfo)} />}
              {mongoInfo && <StatusBadge label="Mongo" connected={!!mongoInfo.connected} title={mongoTitle(mongoInfo)} />}
            </span>
          </div>

          <button ref={menuBtn} type="button" className="hd-menu-btn" aria-expanded={menuOpen} aria-controls="hd-nav"
            aria-label={`Open menu. Current page: ${TABS.find(t => t.id === tab)?.label}`}
            onClick={() => setMenuOpen(o => !o)}>
            <span className="hd-burger" aria-hidden="true"><i /><i /><i /></span>
            <span className="hd-menu-cur">{TABS.find(t => t.id === tab)?.label}</span>
          </button>

          {/* Global topic bar */}
          <div className="hd-topic">
            <input name="topic" autoComplete="off"
              value={topic}
              onChange={e => setTopic(e.target.value)}
              onKeyDown={e => e.key === 'Escape' && setTopic('')}
              placeholder="Enter a research topic here…" aria-label="Enter a research topic here"
            />
            {topic && (
              <button onClick={() => setTopic('')} title="Clear topic" aria-label="Clear topic" style={{ padding: '4px 6px' }}>✕</button>
            )}
          </div>

          {menuOpen && <div className="hd-scrim" onClick={() => { setMenuOpen(false); menuBtn.current?.focus() }} aria-hidden="true" />}
          <nav id="hd-nav" ref={navRef} className={`hd-tabs${menuOpen ? ' open' : ''}`} aria-label="Pages">
            <div className="hd-drawer-head">
              <span className="hd-word" translate="no">ResearchIQ</span>
              <button type="button" className="hd-drawer-x" aria-label="Close menu" onClick={() => { setMenuOpen(false); menuBtn.current?.focus() }}>✕</button>
            </div>
            <span className="hd-badges hd-badges-drawer">
              {neo4jInfo && <StatusBadge showDetail label="Neo4j" connected={!!neo4jInfo.connected} title={neo4jTitle(neo4jInfo)} />}
              {mongoInfo && <StatusBadge showDetail label="Mongo" connected={!!mongoInfo.connected} title={mongoTitle(mongoInfo)} />}
            </span>
            {TABS.map((t, i) => (
              <React.Fragment key={t.id}>
                {i > 0 && <span className="hd-sep">/</span>}
                <button className={`hd-tab${tab === t.id ? ' on' : ''}`} aria-current={tab === t.id ? 'page' : undefined} onClick={() => { setTab(t.id); if (menuOpen) { setMenuOpen(false); menuBtn.current?.focus() } }}>
                  {t.label}
                </button>
              </React.Fragment>
            ))}
          </nav>
        </header>

        {/* Pages — all mounted, just show/hide to preserve state */}
        <main id="ri-main" tabIndex={-1} style={{ flex: 1, overflow: 'hidden', position: 'relative', outline: 'none' }}>
          {[
            ['discover', <MemoDiscover />],
            ['graph',    <MemoGraphAnalytics active={tab === 'graph'} />],
            ['review',   <MemoReview />],
            ['survey',   <MemoSurvey />],
            ['gaps',     <MemoGaps />],
            ['compare',  <MemoCompare />],
            ['chat',     <MemoChat active={tab === 'chat'} />],
            ['roadmap',  <MemoRoadmap />],
            ['history',  <MemoHistory active={tab === 'history'} />],
            ['analytics', <MemoAnalytics active={tab === 'analytics'} />],
          ].map(([id, page]) => (
            <div key={id} className={tab === id ? 'ri-panel' : undefined} style={{
              position: 'absolute', inset: 0,
              display: tab === id ? 'block' : 'none',
              overflow: 'hidden',
            }}>
              <ErrorBoundary name={id}>{page}</ErrorBoundary>
            </div>
          ))}
        </main>
        {themeFooter}
      </div>
      </ToastProvider>
    </TopicContext.Provider>
  )
}
