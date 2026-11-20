import { explainError } from '../utils/errors'
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

const ToastContext = createContext({ toast: () => {}, tab: '', setTab: () => {} })

// toast({ message, kind: 'success' | 'error' | 'info', action: { label, onClick }, duration })
// Errors stay until dismissed; others close themselves.
export function ToastProvider({ tab, setTab, children }) {
  const [items, setItems] = useState([])
  const timers = useRef({})
  const seq = useRef(0)

  const dismiss = useCallback(id => {
    clearTimeout(timers.current[id])
    delete timers.current[id]
    setItems(list => list.filter(t => t.id !== id))
  }, [])

  const toast = useCallback(opts => {
    const o = typeof opts === 'string' ? { message: opts } : opts
    const id = ++seq.current
    const kind = o.kind || 'info'
    let message = o.message, detail = o.detail
    if (kind === 'error') {
      const x = explainError(o.message)
      message = x.hint ? `${x.title} ${x.hint}` : x.title
      detail = detail || x.detail
    }
    setItems(list => [...list.slice(-3), { id, kind, message, detail, action: o.action }])
    const duration = o.duration ?? (kind === 'error' ? 0 : 4000)
    if (duration > 0) timers.current[id] = setTimeout(() => dismiss(id), duration)
    return id
  }, [dismiss])

  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), [])

  return (
    <ToastContext.Provider value={{ toast, tab, setTab }}>
      {children}
      <div className="ri-toasts" role="region" aria-label="Notifications">
        {items.map(t => (
          <div key={t.id} className={`ri-toast ri-toast-${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <span className="ri-toast-msg">
              {t.message}
              {t.detail && t.detail !== t.message && <details><summary>Details</summary><code>{t.detail}</code></details>}
            </span>
            {t.action && (
              <button className="ri-toast-act" onClick={() => { t.action.onClick(); dismiss(t.id) }}>{t.action.label}</button>
            )}
            <button className="ri-toast-x" onClick={() => dismiss(t.id)} aria-label="Dismiss">✕</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext).toast

// For slow jobs (~20-30s): every tab stays mounted, so the user may have moved on.
// Returns notify(message, kind), which toasts with an "Open" action only when the
// user is looking at a different tab. If they are still on this tab, the result is
// already on screen, so nothing is shown.
export function useNotifyDone(tabId, tabLabel) {
  const { toast, tab, setTab } = useContext(ToastContext)
  const tabRef = useRef(tab)
  tabRef.current = tab
  return useCallback((message, kind = 'success') => {
    if (tabRef.current === tabId) return
    toast({ message, kind, action: { label: `Open ${tabLabel}`, onClick: () => setTab(tabId) }, duration: kind === 'error' ? 0 : 7000 })
  }, [toast, setTab, tabId, tabLabel])
}
