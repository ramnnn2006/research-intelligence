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
        <div style={{ background: '#FAF6EC', border: '1px solid #C13B2E', borderRadius: 8, padding: 20, maxWidth: 520, fontSize: 13 }}>
          <div style={{ color: '#C13B2E', fontWeight: 600, marginBottom: 8 }}>⚠️ This tab ran into an error</div>
          <div style={{ color: '#6E6858', marginBottom: 14, wordBreak: 'break-word' }}>{String(this.state.error?.message || this.state.error)}</div>
          <button onClick={() => this.setState({ error: null })}
            style={{ background: '#1E4FA0', color: '#FFFFFF', border: 'none', borderRadius: 6, padding: '6px 14px', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
            Try again
          </button>
        </div>
      </div>
    )
  }
}
