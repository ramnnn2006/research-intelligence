const BASE = '/api'

// FastAPI errors carry {detail}. LLM failures come back as 502 with a readable detail,
// validation errors as a list of objects, so normalise both into one message.
async function errorFrom(r) {
  const e = await r.json().catch(() => ({}))
  let msg = e?.detail
  if (Array.isArray(msg)) msg = msg.map(d => d?.msg || JSON.stringify(d)).join('; ')
  else if (msg && typeof msg !== 'string') msg = JSON.stringify(msg)
  return new Error(msg || `HTTP ${r.status}`)
}

async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw await errorFrom(r)
  return r.json()
}

async function get(path) {
  const r = await fetch(BASE + path)
  if (!r.ok) throw await errorFrom(r)
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

