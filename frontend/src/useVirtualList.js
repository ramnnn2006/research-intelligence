import { useEffect, useRef, useState } from 'react'

// Bounded window virtualization for long lists: only the items near the
// viewport stay mounted; off-screen ranges collapse into spacers sized from
// the measured average item height. Unlike the incremental sentinel list,
// the mounted DOM stays bounded no matter how far the user scrolls.
export default function useVirtualList(items, { estimate = 190, overscan = 6, initial = 30 } = {}) {
  const ref = useRef(null)
  const avg = useRef(estimate)
  const [win, setWin] = useState([0, Math.min(items.length, initial)])

  // new list: start from the top window again
  useEffect(() => { setWin([0, Math.min(items.length, initial)]) }, [items, initial])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // find the nearest ancestor that actually scrolls
    let scroller = el.parentElement
    while (scroller && scroller !== document.body && scroller.scrollHeight <= scroller.clientHeight) {
      scroller = scroller.parentElement
    }
    const useWindow = !scroller || scroller === document.body
    let ticking = false
    function update() {
      ticking = false
      const scTop = useWindow ? window.scrollY : scroller.scrollTop
      const scH = useWindow ? window.innerHeight : scroller.clientHeight
      const scRectTop = useWindow ? 0 : scroller.getBoundingClientRect().top
      const listTop = el.getBoundingClientRect().top - scRectTop + scTop
      const first = Math.max(0, Math.floor((scTop - listTop) / avg.current) - overscan)
      const last = Math.min(items.length, Math.ceil((scTop + scH - listTop) / avg.current) + overscan)
      setWin(w => (w[0] === first && w[1] === last) ? w : [first, Math.max(last, first)])
    }
    function onScroll() {
      if (!ticking) { ticking = true; requestAnimationFrame(update) }
    }
    update()
    const target = useWindow ? window : scroller
    target.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      target.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [items.length, overscan])

  // keep the spacer estimate honest by measuring mounted items
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const kids = el.querySelectorAll('[data-vl-item]')
    if (kids.length > 2) {
      let h = 0
      kids.forEach(k => { h += k.getBoundingClientRect().height })
      const measured = h / kids.length
      if (measured > 0) avg.current = measured
    }
  })

  const start = Math.min(win[0], items.length)
  const end = Math.min(Math.max(win[1], start), items.length)
  return {
    ref,
    visible: items.slice(start, end),
    start,
    topPad: Math.round(start * avg.current),
    bottomPad: Math.round(Math.max(0, items.length - end) * avg.current),
    total: items.length,
  }
}
