import { useEffect, useRef, useState } from 'react'

// Windowed list: render the first `step` items, grow by `step` as the
// sentinel nears the viewport. Bounds initial DOM size for long lists.
export default function useWindowedList(items, step = 30) {
  const [count, setCount] = useState(step)
  const sentinel = useRef(null)
  useEffect(() => { setCount(step) }, [items, step])
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const ob = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) {
        setCount(c => Math.min(c + step, items.length))
      }
    }, { rootMargin: '600px' })
    ob.observe(el)
    return () => ob.disconnect()
  }, [items.length, step])
  const shown = Math.min(count, items.length)
  return { visible: items.slice(0, shown), sentinelRef: sentinel, hasMore: shown < items.length, shown, total: items.length }
}
