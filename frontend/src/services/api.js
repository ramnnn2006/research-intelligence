const BASE = '/api'

async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const e = await r.json().catch(() => ({}))
    throw new Error(e.detail || `HTTP ${r.status}`)
  }
  return r.json()
}

async function get(path) {
  const r = await fetch(BASE + path)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export const api = {
  search:   (query, sources = ['arxiv', 'semantic_scholar'], max_results = 10) =>
              post('/search', { query, sources, max_results }),
  citations: (title)              => post('/citations', { title }),
  review:    (topic)              => post('/review',    { topic }),
  survey:    (topic)              => post('/survey',    { topic }),
  gaps:      (topic)              => post('/gaps',      { topic }),
  compare:   (paper_a, paper_b)   => post('/compare',   { paper_a, paper_b }),
  chat:      (question, use_rag = false) => post('/chat', { question, use_rag }),
  roadmap:   (topic)              => post('/roadmap',   { topic }),
  reports:      ()                   => get('/reports'),
  searches:     ()                   => get('/searches'),
  ragCount:     ()                   => get('/rag/count'),
  dbStats:      ()                   => get('/db/stats'),
  exploreGraph: (topic = '', limit = 30) => get(`/graph/explore?topic=${encodeURIComponent(topic)}&limit=${limit}`),
}

