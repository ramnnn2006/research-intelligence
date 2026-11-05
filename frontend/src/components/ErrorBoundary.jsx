import React from 'react'

// One per tab, so a render error in one page does not blank the whole app.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error(`[${this.props.name || 'tab'}] render error:`, error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ background: '#161b22', border: '1px solid #f85149', borderRadius: 8, padding: 20, maxWidth: 520, fontSize: 13 }}>
          <div style={{ color: '#f85149', fontWeight: 600, marginBottom: 8 }}>⚠️ This tab ran into an error</div>
          <div style={{ color: '#8b949e', marginBottom: 14, wordBreak: 'break-word' }}>{String(this.state.error?.message || this.state.error)}</div>
          <button onClick={() => this.setState({ error: null })}
            style={{ background: '#58a6ff', color: '#000', border: 'none', borderRadius: 6, padding: '6px 14px', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
            Try again
          </button>
        </div>
      </div>
    )
  }
}
