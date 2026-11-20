// Turn a backend or network error message into a short summary plus the exact original.
// Only messages we can recognise from the backend's own wording get tailored guidance;
// everything else is shown as received.
export function explainError(raw) {
  const detail = String(raw ?? '').trim() || 'Unknown error'
  const m = detail
  if (/GROQ_API_KEY/i.test(m)) {
    return { title: 'AI generation is not set up on this server.', hint: 'The backend has no GROQ_API_KEY. Add it to the backend environment and restart.', detail }
  }
  if (/neo4j.*(offline|not connected|unavailable)/i.test(m)) {
    return { title: 'Neo4j is offline.', hint: 'Metrics were not saved, and Graph Intel analytics are unavailable until it is reachable. The Discover graph is built separately and still works.', detail }
  }
  if (/mongo.*(offline|not connected|unavailable)/i.test(m)) {
    return { title: 'MongoDB is offline.', hint: 'Saving and history need the document store.', detail }
  }
  if (/failed to fetch|networkerror|load failed/i.test(m)) {
    return { title: 'Could not reach the ResearchIQ backend.', hint: 'Check that the API server is running.', detail }
  }
  if (/\b429\b|too many requests|rate.?limit/i.test(m)) {
    return { title: 'A data source is rate limiting requests.', hint: 'Wait a minute and try again.', detail }
  }
  return { title: m.length > 160 ? `${m.slice(0, 157)}...` : m, hint: '', detail: m.length > 160 ? m : '' }
}
