import React from 'react'
import Ic from './Ic'

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
        <div style={{ background: 'var(--panel2)', border: '1px solid var(--red)', borderRadius: 8, padding: 20, maxWidth: 520, fontSize: 13 }}>
          <div style={{ color: 'var(--red)', fontWeight: 600, marginBottom: 8 }}><Ic d="warn" /> This tab ran into an error</div>
          <div style={{ color: 'var(--muted)', marginBottom: 14, wordBreak: 'break-word' }}>{String(this.state.error?.message || this.state.error)}</div>
          <button onClick={() => this.setState({ error: null })}
            style={{ background: 'var(--accent)', color: 'var(--on-accent)', border: 'none', borderRadius: 6, padding: '6px 14px', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
            Try again
          </button>
        </div>
      </div>
    )
  }
}
