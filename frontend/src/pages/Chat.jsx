import React, { useState, useRef, useEffect } from 'react'
import { api } from '../services/api'
import Spinner from '../components/Spinner'

const QUICK = [
  'What are the most cited recent papers on transformers?',
  'Summarize key methods in federated learning',
  'What datasets are commonly used in NLP?',
  'What are the main limitations of RAG systems?',
  'Compare attention mechanisms in BERT vs GPT',
  'What is the state of the art in object detection?',
  'Explain diffusion models for image generation',
]

function Md({ text }) {
  if (!text) return <span style={{ color: 'var(--muted)' }}>…</span>
  const html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`\n]+)`/g, '<code style="background:rgba(255,255,255,.1);padding:1px 5px;border-radius:3px;font-family:monospace">$1</code>')
    .replace(/^### (.+)$/gm, '<h4 style="color:#58a6ff;margin:10px 0 4px;font-size:13px">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 style="color:#58a6ff;margin:10px 0 5px;font-size:14px">$1</h3>')
    .replace(/^- (.+)$/gm, '<li style="margin:3px 0">$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li style="margin:3px 0">$1</li>')
    .replace(/(<li[\s\S]*?<\/li>)+/g, '<ul style="padding-left:16px;margin:6px 0">$&</ul>')
    .replace(/\n\n/g, '</p><p style="margin:6px 0">')
    .replace(/\n/g, '<br/>')
  return (
    <div
      style={{ lineHeight: 1.7, fontSize: 13 }}
      dangerouslySetInnerHTML={{ __html: '<p style="margin:0">' + html + '</p>' }}
    />
  )
}

export default function Chat() {
  const [msgs, setMsgs] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [useRag, setUseRag] = useState(false)
  const bottomRef = useRef()
  const inputRef = useRef()

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, loading])

  async function send(q) {
    const question = (q || input).trim()
    if (!question || loading) return
    setInput('')
    setMsgs(m => [...m, { role: 'user', content: question }])
    setLoading(true)
    try {
      const data = await api.chat(question, useRag)
      setMsgs(m => [...m, { role: 'bot', content: data.answer, sources: data.sources }])
    } catch (e) {
      setMsgs(m => [...m, { role: 'bot', content: `⚠️ Error: ${e.message}` }])
    }
    setLoading(false)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  return (
    <div style={{ height: '100%', display: 'flex', overflow: 'hidden' }}>
      {/* Sidebar */}
      <div style={{
        width: 230, flexShrink: 0, borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: 14, gap: 12,
      }}>
        <div style={{ background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>⚙️ Settings</div>
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: 'var(--muted2)', cursor: 'pointer' }}>
            <input type="checkbox" checked={useRag} onChange={e => setUseRag(e.target.checked)}
              style={{ accentColor: 'var(--accent)', marginTop: 1 }} />
            <span>Use collected papers (RAG)<br />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                Uncheck to search fresh papers from ArXiv for each question
              </span>
            </span>
          </label>
        </div>

        <div style={{ background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.06em' }}>
            Quick Questions
          </div>
          {QUICK.map((q, i) => (
            <button key={i} onClick={() => send(q)} disabled={loading}
              style={{
                width: '100%', background: 'none', border: '1px solid var(--border)',
                borderRadius: 5, color: 'var(--muted2)', padding: '7px 8px', fontSize: 11,
                textAlign: 'left', marginBottom: 5, lineHeight: 1.4, cursor: 'pointer',
                transition: 'border-color .15s',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
            >
              {q}
            </button>
          ))}
          {msgs.length > 0 && (
            <button onClick={() => setMsgs([])}
              style={{
                width: '100%', background: 'none', border: '1px solid var(--red)',
                borderRadius: 5, color: 'var(--red)', padding: '6px 8px',
                fontSize: 11, marginTop: 4, cursor: 'pointer',
              }}>
              🗑 Clear chat
            </button>
          )}
        </div>
      </div>

      {/* Chat main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {msgs.length === 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: '100%', flexDirection: 'column', gap: 10, color: 'var(--muted)',
            }}>
              <div style={{ fontSize: 40 }}>💬</div>
              <div style={{ fontSize: 15, fontWeight: 500 }}>Ask anything about research</div>
              <div style={{ fontSize: 12, textAlign: 'center', maxWidth: 340, lineHeight: 1.6 }}>
                Ask questions, get paper summaries, compare methods, understand results.
                Pick a quick question or type your own.
              </div>
            </div>
          )}

          {msgs.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '82%',
                background: m.role === 'user' ? 'var(--accent)' : 'var(--panel2)',
                color: m.role === 'user' ? '#000' : 'var(--text)',
                borderRadius: 12,
                borderBottomRightRadius: m.role === 'user' ? 3 : 12,
                borderBottomLeftRadius: m.role === 'bot' ? 3 : 12,
                padding: '10px 14px',
                border: m.role === 'bot' ? '1px solid var(--border)' : 'none',
              }}>
                {m.role === 'user'
                  ? <div style={{ fontSize: 13, fontWeight: 500 }}>{m.content}</div>
                  : <Md text={m.content} />
                }
                {m.sources?.length > 0 && (
                  <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5 }}>📚 Sources used:</div>
                    {m.sources.slice(0, 4).map((s, j) => (
                      <a key={j} href={s.url || s.id} target="_blank" rel="noreferrer"
                        style={{ display: 'block', fontSize: 11, color: 'var(--accent)', lineHeight: 1.5, marginBottom: 3 }}>
                        [{j + 1}] {(s.title || '').substring(0, 70)}{s.title?.length > 70 ? '…' : ''}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <div style={{
                background: 'var(--panel2)', border: '1px solid var(--border)',
                borderRadius: 12, borderBottomLeftRadius: 3, padding: '10px 14px',
              }}>
                <Spinner />
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>Searching papers and generating answer…</span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div style={{
          borderTop: '1px solid var(--border)', padding: '12px 20px',
          display: 'flex', gap: 10, flexShrink: 0,
        }}>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            disabled={loading}
            placeholder="Ask about methods, papers, datasets, results…"
            style={{
              flex: 1, background: 'var(--panel2)', border: '1px solid var(--border)',
              borderRadius: 8, color: 'var(--text)', padding: '10px 14px',
              fontSize: 14, outline: 'none', transition: 'border-color .15s',
            }}
            onFocus={e => e.target.style.borderColor = 'var(--accent)'}
            onBlur={e => e.target.style.borderColor = 'var(--border)'}
          />
          <button
            onClick={() => send()}
            disabled={loading || !input.trim()}
            style={{
              background: loading || !input.trim() ? 'var(--border)' : 'var(--accent)',
              color: loading || !input.trim() ? 'var(--muted)' : '#000',
              border: 'none', borderRadius: 8, padding: '10px 22px',
              fontWeight: 600, fontSize: 14, transition: 'all .15s',
              cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            Send ↑
          </button>
        </div>
      </div>
    </div>
  )
}
