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

async function del(path) {
  const r = await fetch(BASE + path, { method: 'DELETE' })
  if (!r.ok) throw await errorFrom(r)
  return r.json()
}

async function upload(path, file) {
  const fd = new FormData()
  fd.append('file', file)
  const r = await fetch(BASE + path, { method: 'POST', body: fd })
  if (!r.ok) throw await errorFrom(r)
  return r.json()
}

export const api = {
  search:   (query, sources = ['arxiv', 'semantic_scholar'], max_results = 10) =>
              post('/search', { query, sources, max_results }),
  citations: (title, limit = 15)  => post('/citations', { title, limit }),
  searchAuthor: (name, max_results = 20) => post('/author/search', { name, max_results }),
  getAuthor:    (name, limit = 20)       => get(`/author?name=${encodeURIComponent(name)}&limit=${limit}`),
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
  neo4jStatus:   ()                 => get('/neo4j/status'),
  neo4jMultihop: (title, hops = 2)  => post('/neo4j/citations/multihop', { title, hops }),
  neo4jGraph:    (topic)            => get(`/neo4j/graph/${encodeURIComponent(topic)}`),
  mongoStatus:   ()                 => get('/mongodb/status'),
  nosqlStatus:   ()                 => get('/nosql/status'),
  pdfStatus:     ()                 => get('/pdf/status'),
  pdfClear:      ()                 => del('/pdf/clear'),
  pdfChat:       (question)         => post('/pdf/chat', { question }),
  pdfFetchArxiv: (arxiv_id)         => post('/pdf/fetch_arxiv', { arxiv_id }),
  pdfUpload:     (file)             => upload('/pdf/upload', file),
  graphAnalytics: (params = {}) => {
    const q = new URLSearchParams()
    if (params.topic) q.append('topic', params.topic)
    if (params.metric) q.append('metric', params.metric)
    if (params.limit) q.append('limit', params.limit)
    return get(`/graph/analytics?${q.toString()}`)
  },
  graphSyncMetrics: ()              => post('/graph/sync_metrics', {}),
  hfModels:   (query, limit = 8)    => get(`/hf/models?query=${encodeURIComponent(query)}&limit=${limit}`),
  hfDatasets: (query, limit = 8)    => get(`/hf/datasets?query=${encodeURIComponent(query)}&limit=${limit}`),
}

