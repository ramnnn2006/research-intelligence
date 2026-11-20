import { useEffect, useRef } from 'react'

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

// Escape closes, Tab stays inside the dialog, focus returns to what opened it.
export default function useDialog(active, onClose) {
  const ref = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!active) return
    const opener = document.activeElement
    const node = ref.current
    if (node) {
      const first = node.querySelector(FOCUSABLE)
      ;(first || node).focus({ preventScroll: true })
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current?.(); return }
      if (e.key !== 'Tab' || !ref.current) return
      const items = [...ref.current.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null)
      if (!items.length) { e.preventDefault(); return }
      const a = items[0], z = items[items.length - 1]
      if (e.shiftKey && (document.activeElement === a || !ref.current.contains(document.activeElement))) { e.preventDefault(); z.focus() }
      else if (!e.shiftKey && (document.activeElement === z || !ref.current.contains(document.activeElement))) { e.preventDefault(); a.focus() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      if (opener && opener.focus && document.contains(opener)) opener.focus({ preventScroll: true })
    }
  }, [active])
  return ref
}
