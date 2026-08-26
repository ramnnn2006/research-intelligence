import React, { useState, createContext, useContext } from 'react'
import Discover from './pages/Discover'
import Review from './pages/Review'
import Survey from './pages/Survey'
import Gaps from './pages/Gaps'
import Compare from './pages/Compare'
import Chat from './pages/Chat'
import Roadmap from './pages/Roadmap'
import History from './pages/History'

// Shared context so any tab can read/write the global topic
export const TopicContext = createContext({ topic: '', setTopic: () => {} })
export const useTopicContext = () => useContext(TopicContext)

const TABS = [
  { id: 'discover', label: '🔍 Discover' },
  { id: 'review',   label: '📖 Review' },
  { id: 'survey',   label: '📚 Survey' },
  { id: 'gaps',     label: '💡 Gaps' },
  { id: 'compare',  label: '⚖️ Compare' },
  { id: 'chat',     label: '💬 Chat' },
  { id: 'roadmap',  label: '🗺️ Roadmap' },
  { id: 'history',  label: '🗂️ History' },
]

export default function App() {
  const [tab, setTab] = useState('discover')
  const [topic, setTopic] = useState('')

  return (
    <TopicContext.Provider value={{ topic, setTopic }}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        {/* Header */}
        <header style={{
          background: '#0d1117', borderBottom: '1px solid #21262d',
          padding: '0 16px', height: 50, display: 'flex', alignItems: 'center',
          gap: 12, flexShrink: 0, zIndex: 100,
        }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#58a6ff', flexShrink: 0 }}>
            ⚗️ ResearchIQ
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
            ['review',   <Review />],
            ['survey',   <Survey />],
            ['gaps',     <Gaps />],
            ['compare',  <Compare />],
            ['chat',     <Chat />],
            ['roadmap',  <Roadmap />],
            ['history',  <History />],
          ].map(([id, page]) => (
            <div key={id} style={{
              position: 'absolute', inset: 0,
              display: tab === id ? 'block' : 'none',
              overflow: 'hidden',
            }}>
              {page}
            </div>
          ))}
        </main>
      </div>
    </TopicContext.Provider>
  )
}
