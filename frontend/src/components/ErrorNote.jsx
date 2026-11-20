import React from 'react'
import { explainError } from '../utils/errors'

// Inline error: readable summary first, exact backend message under "Details".
export default function ErrorNote({ error }) {
  if (!error) return null
  const { title, hint, detail } = explainError(error)
  return (
    <div role="alert" className="ri-errnote">
      <div><strong>{title}</strong>{hint ? ` ${hint}` : ''}</div>
      {detail && detail !== title && (
        <details><summary>Details</summary><code>{detail}</code></details>
      )}
    </div>
  )
}
