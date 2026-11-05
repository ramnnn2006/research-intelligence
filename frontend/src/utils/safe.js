// Small helpers for rendering data that comes from external APIs or the LLM.

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => HTML_ESCAPES[c])
}

// Returns the URL only when it is an absolute http(s) link, otherwise null.
export function safeHttpUrl(value) {
  if (!value || typeof value !== 'string') return null
  try {
    const u = new URL(value.trim())
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

// LLM JSON is not always the shape we asked for. Turn any value into display text.
export function toText(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join(', ')
  if (typeof value === 'object') {
    for (const k of ['text', 'title', 'name', 'content', 'description', 'gap', 'task', 'skill']) {
      if (typeof value[k] === 'string') return value[k]
    }
    try { return JSON.stringify(value) } catch { return String(value) }
  }
  return String(value)
}

export function asArray(value) {
  return Array.isArray(value) ? value : []
}

// Parses backend timestamps. Strings without a timezone are treated as UTC,
// and "YYYY-MM-DD HH:MM:SS" plus long fractional seconds are normalised so Safari accepts them.
export function parseTimestamp(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number') {
    const d = new Date(value)
    return isNaN(d) ? null : d
  }
  let s = String(value).trim().replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1')
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s += 'Z'
  const d = new Date(s)
  return isNaN(d) ? null : d
}
