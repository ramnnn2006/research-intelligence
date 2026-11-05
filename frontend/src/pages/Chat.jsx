import React, { useState, useRef, useEffect } from 'react'
import { api } from '../services/api'
import Spinner from '../components/Spinner'
import { safeHttpUrl, toText, asArray } from '../utils/safe'

const MAX_PDF_MB = 25

// pdf/status lists papers as {name, pages, chunks}; older servers sent plain names
function pdfPapers(stats) {
  return asArray(stats?.papers).map(p => (p && typeof p === 'object'
    ? { name: toText(p.name) || 'Document', pages: p.pages, chunks: p.chunks }
    : { name: toText(p) || 'Document' }))
}

// The backend ignores a PDF that is already loaded; accept a few ways it may say so
function alreadyLoaded(res) {
  return Boolean(res?.duplicate || res?.already_loaded || res?.info?.duplicate || res?.info?.already_loaded)
}

function pdfLabel(papers) {
  if (papers.length === 0) return 'Document'
  if (papers.length === 1) return papers[0].name
  return `${papers.length} papers`
}

const GLOBAL_QUICK = [
  'What are the most cited recent papers on transformers?',
  'Summarize key methods in federated learning',
  'What datasets are commonly used in NLP?',
  'What are the main limitations of RAG systems?',
  'Compare attention mechanisms in BERT vs GPT',
  'What is the state of the art in object detection?',
  'Explain diffusion models for image generation',
]

const PDF_QUICK = [
  'What is the core proposed methodology or architecture?',
  'What are the key quantitative benchmarks and results?',
  'What datasets and baseline models are evaluated against?',
  'What are the primary limitations and future work discussed?',
  'Summarize the experimental setup and hyperparameters',
]

const SAMPLE_PAPERS = [
  { name: 'Attention Is All You Need', id: '1706.03762' },
  { name: 'LoRA: Low-Rank Adaptation', id: '2106.09685' },
  { name: 'Retrieval-Augmented Generation Survey', id: '2312.10997' },
]

function formatMarkdown(text) {
  if (!text) return ''
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`\n]+)`/g, '<code style="background:rgba(255,255,255,.08);padding:1px 5px;border-radius:4px;font-family:monospace;font-size:12px">$1</code>')
    .replace(/^### (.+)$/gm, '<h4 style="color:#58a6ff;margin:12px 0 4px;font-size:13px;font-weight:600">$1</h4>')
    .replace(/^## (.+)$/gm, '<h3 style="color:#58a6ff;margin:14px 0 6px;font-size:14px;font-weight:600">$1</h3>')
    .replace(/^- (.+)$/gm, '<li style="margin:4px 0">$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li style="margin:4px 0">$1</li>')
    .replace(/(<li[\s\S]*?<\/li>)+/g, '<ul style="padding-left:18px;margin:8px 0">$&</ul>')
    .replace(/\n\n/g, '</p><p style="margin:8px 0">')
    .replace(/\n/g, '<br/>')

  // Highlight page citations like [Page 5] or [Page 3, 4]
  html = html.replace(/\[Page\s*([0-9,\s\-]+)\]/gi, (m, pages) => {
    return `<span style="display:inline-flex;align-items:center;background:rgba(88,166,255,0.15);color:#58a6ff;border:1px solid rgba(88,166,255,0.35);padding:1px 6px;border-radius:12px;font-size:11px;font-weight:600;margin:0 2px;letter-spacing:0.02em">📄 Page ${pages}</span>`
  })

  return '<p style="margin:0">' + html + '</p>'
}

function Md({ text }) {
  if (!text) return <span style={{ color: 'var(--muted)' }}>…</span>
  return (
    <div
      style={{ lineHeight: 1.7, fontSize: 13 }}
      // formatMarkdown escapes & < > before adding its own tags
      dangerouslySetInnerHTML={{ __html: formatMarkdown(toText(text)) }}
    />
  )
}

export default function Chat() {
  const [mode, setMode] = useState('global') // 'global' | 'pdf'
  const [msgs, setMsgs] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [useRag, setUseRag] = useState(false)

  // PDF-specific state
  const [pdfStats, setPdfStats] = useState({ loaded: false, total_papers: 0, papers: [], total_pages: 0, total_chunks: 0 })
  const [loadingPdf, setLoadingPdf] = useState(false)
  const [pdfActionMsg, setPdfActionMsg] = useState('')
  const [arxivIdInput, setArxivIdInput] = useState('')
  const [expandedChunks, setExpandedChunks] = useState({})

  const fileInputRef = useRef()
  const bottomRef = useRef()
  const inputRef = useRef()
  const msgId = useRef(0)
  const loadedPapers = pdfPapers(pdfStats)

  // every message gets a stable id, so per-message UI state (expanded excerpts) cannot leak
  const addMsg = m => setMsgs(prev => [...prev, { ...m, id: ++msgId.current }])

  function clearChat() {
    setMsgs([])
    setExpandedChunks({})
  }

  useEffect(() => {
    refreshPdfStatus()
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [msgs, loading, loadingPdf])

  async function refreshPdfStatus() {
    try {
      const stats = await api.pdfStatus()
      setPdfStats(stats)
    } catch (e) {
      console.warn('Could not fetch PDF status:', e)
    }
  }

  async function handleFileUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > MAX_PDF_MB * 1024 * 1024) {
      setPdfActionMsg(`❌ ${file.name} is larger than ${MAX_PDF_MB} MB`)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    setLoadingPdf(true)
    setPdfActionMsg(`Extracting text and chunking ${file.name}…`)
    try {
      const res = await api.pdfUpload(file)
      await refreshPdfStatus()
      const name = toText(res.info?.name) || file.name
      if (alreadyLoaded(res)) { setPdfActionMsg(`ℹ️ ${name} is already loaded`); return }
      setPdfActionMsg(`✅ Loaded ${name} (${res.info?.pages ?? '?'} pages, ${res.info?.chunks ?? '?'} chunks indexed)`)
      addMsg({
        role: 'bot',
        content: `📄 **Successfully loaded full paper**: \`${name}\`\n\n- **Pages**: ${res.info?.pages ?? '?'}\n- **Chunks Indexed**: ${res.info?.chunks ?? '?'}\n\nYou can now ask any question about equations, architectures, tables, or conclusions in this paper. Answers will include precise **[Page X]** citations.`,
      })
    } catch (err) {
      setPdfActionMsg(`❌ Failed to upload: ${err.message}`)
    } finally {
      setLoadingPdf(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleFetchArxiv(arxivId) {
    const aid = (arxivId || arxivIdInput).trim()
    if (!aid) return
    setLoadingPdf(true)
    setPdfActionMsg(`Downloading & indexing full PDF for ArXiv ${aid}…`)
    try {
      const res = await api.pdfFetchArxiv(aid)
      await refreshPdfStatus()
      setArxivIdInput('')
      const name = toText(res.info?.name) || `${aid}.pdf`
      if (alreadyLoaded(res)) { setPdfActionMsg(`ℹ️ ${name} is already loaded`); return }
      setPdfActionMsg(`✅ Loaded ${name} (${res.info?.pages ?? '?'} pages, ${res.info?.chunks ?? '?'} chunks)`)
      addMsg({
        role: 'bot',
        content: `📄 **Successfully downloaded & indexed ArXiv PDF**: \`${name}\`\n\n- **Pages**: ${res.info?.pages ?? '?'}\n- **Chunks Indexed**: ${res.info?.chunks ?? '?'}\n\nAsk any question to search through the entire full text with page-level citations!`,
      })
    } catch (err) {
      setPdfActionMsg(`❌ Fetch failed: ${err.message}`)
    } finally {
      setLoadingPdf(false)
    }
  }

  async function handleClearPdf() {
    try {
      await api.pdfClear()
      await refreshPdfStatus()
      setPdfActionMsg('Cleared loaded PDF store.')
      addMsg({ role: 'bot', content: '🧹 Cleared active PDF memory store.' })
    } catch (err) {
      setPdfActionMsg(`❌ Clear failed: ${err.message}`)
    }
  }

  async function send(q) {
    const question = (q || input).trim()
    if (!question || loading || loadingPdf) return
    setInput('')
    addMsg({ role: 'user', content: question, mode })
    setLoading(true)

    try {
      if (mode === 'pdf') {
        if (!pdfStats.loaded) {
          addMsg({
            role: 'bot',
            content: '⚠️ **No PDF is currently loaded.** Please upload a PDF or enter an ArXiv ID (e.g. `1706.03762`) in the sidebar first to chat with full paper text.',
          })
          return
        }
        const data = await api.pdfChat(question)
        addMsg({
          role: 'bot',
          content: toText(data?.answer),
          chunks: asArray(data?.chunks),
          mode: 'pdf'
        })
      } else {
        // Global mode
        const data = await api.chat(question, useRag)
        addMsg({
          role: 'bot',
          content: toText(data?.answer),
          sources: asArray(data?.sources),
          mode: 'global'
        })
      }
    } catch (e) {
      // LLM failures arrive as 502 with a readable detail message
      addMsg({ role: 'bot', content: `⚠️ Error: ${e.message}` })
    } finally {
      setLoading(false)
    }
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const toggleChunks = (id) => {
    setExpandedChunks(prev => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div style={{ height: '100%', display: 'flex', overflow: 'hidden' }}>
      {/* Sidebar */}
      <div style={{
        width: 270, flexShrink: 0, borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: 14, gap: 12,
        background: 'var(--panel)',
      }}>
        {/* Mode Selector */}
        <div style={{ background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 8, padding: 4, display: 'flex', gap: 4 }}>
          <button
            onClick={() => setMode('pdf')}
            style={{
              flex: 1, padding: '7px 4px', fontSize: 11, fontWeight: 600, borderRadius: 6,
              border: 'none', cursor: 'pointer', transition: 'all .15s',
              background: mode === 'pdf' ? 'var(--accent)' : 'transparent',
              color: mode === 'pdf' ? '#000' : 'var(--muted)',
            }}
          >
            📄 Full PDF RAG
          </button>
          <button
            onClick={() => setMode('global')}
            style={{
              flex: 1, padding: '7px 4px', fontSize: 11, fontWeight: 600, borderRadius: 6,
              border: 'none', cursor: 'pointer', transition: 'all .15s',
              background: mode === 'global' ? 'var(--accent)' : 'transparent',
              color: mode === 'global' ? '#000' : 'var(--muted)',
            }}
          >
            🌐 ArXiv Search RAG
          </button>
        </div>

        {/* PDF Mode Sidebar Controls */}
        {mode === 'pdf' ? (
          <>
            {/* Active Document Status Card */}
            <div style={{ background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: pdfStats.loaded ? 'var(--green)' : 'var(--muted2)'
                  }} />
                  Paper In Memory
                </span>
                {pdfStats.loaded && (
                  <button
                    onClick={handleClearPdf}
                    style={{ background: 'none', border: 'none', color: 'var(--red)', fontSize: 11, cursor: 'pointer' }}
                    title="Unload PDF"
                  >
                    Clear
                  </button>
                )}
              </div>

              {pdfStats.loaded ? (
                <div style={{ fontSize: 11, lineHeight: 1.5 }}>
                  {/* every loaded PDF is searched, so list them all */}
                  {loadedPapers.map((p, i) => (
                    <div key={i} style={{ marginBottom: 4 }}>
                      <div style={{ fontWeight: 600, color: 'var(--text)', wordBreak: 'break-all' }}>
                        📄 {p.name}
                      </div>
                      {(p.pages != null || p.chunks != null) && (
                        <div style={{ color: 'var(--muted)', fontSize: 10 }}>
                          {p.pages != null && `${p.pages} pages`}{p.pages != null && p.chunks != null && ' · '}{p.chunks != null && `${p.chunks} chunks`}
                        </div>
                      )}
                    </div>
                  ))}
                  <div style={{ color: 'var(--muted)', display: 'flex', gap: 10, fontSize: 11 }}>
                    <span>📖 {pdfStats.total_pages} pages</span>
                    <span>🧩 {pdfStats.total_chunks} chunks</span>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
                  No paper loaded yet. Upload any PDF or load directly from ArXiv below.
                </div>
              )}

              {pdfActionMsg && (
                <div style={{ fontSize: 11, color: 'var(--muted2)', marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                  {pdfActionMsg}
                </div>
              )}
            </div>

            {/* Upload or Fetch Card */}
            <div style={{ background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                Load Paper
              </div>

              {/* Upload Button */}
              <input
                type="file"
                ref={fileInputRef}
                accept=".pdf"
                onChange={handleFileUpload}
                style={{ display: 'none' }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={loadingPdf}
                style={{
                  width: '100%', background: 'rgba(88,166,255,0.08)', border: '1px dashed var(--accent)',
                  borderRadius: 6, color: 'var(--accent)', padding: '8px 10px', fontSize: 12,
                  fontWeight: 500, cursor: loadingPdf ? 'not-allowed' : 'pointer', marginBottom: 10,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                }}
              >
                📤 Upload Local PDF
              </button>

              {/* ArXiv ID Loader */}
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <input
                  value={arxivIdInput}
                  onChange={e => setArxivIdInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleFetchArxiv()}
                  placeholder="ArXiv ID (e.g. 1706.03762)"
                  disabled={loadingPdf}
                  style={{
                    flex: 1, background: 'var(--bg)', border: '1px solid var(--border)',
                    borderRadius: 5, color: 'var(--text)', padding: '6px 8px', fontSize: 11, outline: 'none'
                  }}
                />
                <button
                  onClick={() => handleFetchArxiv()}
                  disabled={loadingPdf || !arxivIdInput.trim()}
                  style={{
                    background: 'var(--accent)', color: '#000', border: 'none',
                    borderRadius: 5, padding: '6px 10px', fontSize: 11, fontWeight: 600,
                    cursor: loadingPdf || !arxivIdInput.trim() ? 'not-allowed' : 'pointer'
                  }}
                >
                  Load
                </button>
              </div>

              {/* Sample Papers */}
              <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4, textTransform: 'uppercase' }}>
                1-Click Samples:
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {SAMPLE_PAPERS.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => handleFetchArxiv(p.id)}
                    disabled={loadingPdf}
                    style={{
                      background: 'none', border: '1px solid var(--border)', borderRadius: 4,
                      color: 'var(--muted2)', padding: '4px 6px', fontSize: 10, textAlign: 'left',
                      cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 170 }}>{p.name}</span>
                    <span style={{ color: 'var(--muted)' }}>{p.id}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* PDF Quick Questions */}
            <div style={{ background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                Deep Paper Prompts
              </div>
              {PDF_QUICK.map((q, i) => (
                <button key={i} onClick={() => send(q)} disabled={loading || loadingPdf}
                  style={{
                    width: '100%', background: 'none', border: '1px solid var(--border)',
                    borderRadius: 5, color: 'var(--muted2)', padding: '6px 8px', fontSize: 11,
                    textAlign: 'left', marginBottom: 5, lineHeight: 1.35, cursor: 'pointer',
                    transition: 'border-color .15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                >
                  {q}
                </button>
              ))}
            </div>
          </>
        ) : (
          /* Global ArXiv Search Settings */
          <>
            <div style={{ background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 8, padding: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>⚙️ Global Settings</div>
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
              {GLOBAL_QUICK.map((q, i) => (
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
            </div>
          </>
        )}

        {msgs.length > 0 && (
          <button onClick={clearChat}
            style={{
              width: '100%', background: 'none', border: '1px solid var(--red)',
              borderRadius: 5, color: 'var(--red)', padding: '6px 8px',
              fontSize: 11, marginTop: 'auto', cursor: 'pointer',
            }}>
            🗑 Clear chat
          </button>
        )}
      </div>

      {/* Chat Main Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>
        {/* Banner indicator */}
        <div style={{
          padding: '8px 20px', borderBottom: '1px solid var(--border)', background: 'var(--panel2)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              background: mode === 'pdf' ? 'rgba(88,166,255,0.15)' : 'rgba(124,58,237,0.15)',
              color: mode === 'pdf' ? 'var(--accent)' : 'var(--purple)',
              padding: '2px 8px', borderRadius: 4, fontWeight: 600, fontSize: 11,
              border: `1px solid ${mode === 'pdf' ? 'rgba(88,166,255,0.3)' : 'rgba(124,58,237,0.3)'}`
            }}>
              {mode === 'pdf' ? '📄 Full PDF Deep RAG' : '🌐 Global ArXiv RAG'}
            </span>
            <span style={{ color: 'var(--muted)' }}>
              {mode === 'pdf'
                ? (pdfStats.loaded
                    ? `Active: ${loadedPapers.map(p => p.name).join(', ') || 'Document'} (${pdfStats.total_pages} pages, ${pdfStats.total_chunks} chunks)`
                    : 'No PDF loaded. Select or upload a paper on the left')
                : 'Searching dynamic literature and abstracts'}
            </span>
          </div>

          {mode === 'pdf' && !pdfStats.loaded && (
            <button
              onClick={() => handleFetchArxiv('1706.03762')}
              disabled={loadingPdf}
              style={{
                background: 'none', border: '1px solid var(--accent)', color: 'var(--accent)',
                borderRadius: 4, padding: '3px 8px', fontSize: 11, cursor: 'pointer'
              }}
            >
              Try Attention Paper (1706.03762)
            </button>
          )}
        </div>

        {/* Messages list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {msgs.length === 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: '100%', flexDirection: 'column', gap: 12, color: 'var(--muted)',
            }}>
              <div style={{ fontSize: 44 }}>{mode === 'pdf' ? '📄' : '💬'}</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)' }}>
                {mode === 'pdf' ? 'Deep Full-Paper RAG Analysis' : 'Ask Anything About AI Research'}
              </div>
              <div style={{ fontSize: 13, textAlign: 'center', maxWidth: 420, lineHeight: 1.6 }}>
                {mode === 'pdf'
                  ? 'Upload any PDF or fetch from ArXiv to interrogate formulas, datasets, and architectures with exact [Page X] citations.'
                  : 'Ask conceptual questions, get synthesis across papers, and discover literature from ArXiv and Semantic Scholar.'}
              </div>
              {mode === 'pdf' && !pdfStats.loaded && (
                <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      background: 'var(--accent)', color: '#000', border: 'none',
                      borderRadius: 6, padding: '8px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer'
                    }}
                  >
                    📤 Upload a PDF
                  </button>
                  <button
                    onClick={() => handleFetchArxiv('1706.03762')}
                    disabled={loadingPdf}
                    style={{
                      background: 'var(--panel2)', color: 'var(--accent)', border: '1px solid var(--accent)',
                      borderRadius: 6, padding: '8px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer'
                    }}
                  >
                    ⚡ Load Attention Paper (1706.03762)
                  </button>
                </div>
              )}
            </div>
          )}

          {msgs.map(m => (
            <div key={m.id} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '85%',
                background: m.role === 'user' ? 'var(--accent)' : 'var(--panel2)',
                color: m.role === 'user' ? '#000' : 'var(--text)',
                borderRadius: 12,
                borderBottomRightRadius: m.role === 'user' ? 3 : 12,
                borderBottomLeftRadius: m.role === 'bot' ? 3 : 12,
                padding: '12px 16px',
                border: m.role === 'bot' ? '1px solid var(--border)' : 'none',
              }}>
                {m.role === 'user' ? (
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{m.content}</div>
                ) : (
                  <div>
                    <Md text={m.content} />

                    {/* PDF Retrived Chunks / Page Excerpts */}
                    {m.chunks?.length > 0 && (
                      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                        <button
                          onClick={() => toggleChunks(m.id)}
                          style={{
                            background: 'none', border: 'none', color: 'var(--accent)',
                            fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: 0
                          }}
                        >
                          <span>{expandedChunks[m.id] ? '▼ Hide' : '▶ Show'} {m.chunks.length} Grounded Excerpts</span>
                          <span style={{ fontSize: 10, color: 'var(--muted)' }}>
                            ({[...new Set(m.chunks.map(c => `Page ${c.page}`))].join(', ')})
                          </span>
                        </button>

                        {expandedChunks[m.id] && (
                          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {m.chunks.map((c, ci) => (
                              <div key={ci} style={{
                                background: 'rgba(0,0,0,0.25)', border: '1px solid var(--border)',
                                borderRadius: 6, padding: '8px 10px', fontSize: 11,
                              }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                  <span style={{
                                    background: 'rgba(88,166,255,0.2)', color: 'var(--accent)',
                                    padding: '1px 6px', borderRadius: 10, fontWeight: 600, fontSize: 10
                                  }}>
                                    📄 Page {c.page}
                                  </span>
                                  <span style={{ color: 'var(--muted)', fontSize: 10 }}>{toText(c.paper)}</span>
                                </div>
                                <div style={{ color: 'var(--muted2)', fontStyle: 'italic', lineHeight: 1.4 }}>
                                  "{toText(c.text)}…"
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Global Sources */}
                    {m.sources?.length > 0 && (
                      <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                        <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 5 }}>📚 Sources used:</div>
                        {m.sources.slice(0, 4).map((s, j) => (
                          <a key={j} href={safeHttpUrl(s.url || s.id) || undefined} target="_blank" rel="noreferrer"
                            style={{ display: 'block', fontSize: 11, color: 'var(--accent)', lineHeight: 1.5, marginBottom: 3 }}>
                            [{j + 1}] {toText(s.title).substring(0, 70)}{toText(s.title).length > 70 ? '…' : ''}
                          </a>
                        ))}
                      </div>
                    )}
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
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <Spinner />
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                  {mode === 'pdf'
                    ? 'Retrieving page excerpts and analyzing full paper text…'
                    : 'Searching papers and generating synthesis…'}
                </span>
              </div>
            </div>
          )}

          {loadingPdf && (
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <div style={{
                background: 'var(--panel2)', border: '1px solid var(--border)',
                borderRadius: 12, borderBottomLeftRadius: 3, padding: '10px 14px',
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <Spinner />
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>
                  {pdfActionMsg || 'Processing PDF document…'}
                </span>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input Bar */}
        <div style={{
          borderTop: '1px solid var(--border)', padding: '12px 20px',
          display: 'flex', gap: 10, flexShrink: 0, background: 'var(--panel)',
        }}>
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            disabled={loading || loadingPdf}
            placeholder={
              mode === 'pdf'
                ? (pdfStats.loaded
                    ? `Ask about equations, formulas, results in ${pdfLabel(loadedPapers)}…`
                    : 'Upload a PDF or enter ArXiv ID on the left first to ask questions…')
                : 'Ask about methods, papers, datasets, results…'
            }
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
            disabled={loading || loadingPdf || !input.trim()}
            style={{
              background: loading || loadingPdf || !input.trim() ? 'var(--border)' : 'var(--accent)',
              color: loading || loadingPdf || !input.trim() ? 'var(--muted)' : '#000',
              border: 'none', borderRadius: 8, padding: '10px 22px',
              fontWeight: 600, fontSize: 14, transition: 'all .15s',
              cursor: loading || loadingPdf || !input.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            Send ↑
          </button>
        </div>
      </div>
    </div>
  )
}
