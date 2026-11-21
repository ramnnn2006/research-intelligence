import { useEffect, useState } from 'react'

const validTheme = value => value === 'dark' || value === 'light'
function savedTheme() {
  try { return localStorage.getItem('ri.theme') } catch { return null }
}
const systemTheme = () => window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

export default function useTheme() {
  const [theme, setTheme] = useState(() => {
    const saved = savedTheme()
    return validTheme(saved) ? saved : systemTheme()
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.content = theme === 'dark' ? '#000000' : '#FAF6EC'
  }, [theme])

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onSystemChange = () => { if (!validTheme(savedTheme())) setTheme(systemTheme()) }
    const onStorage = event => {
      if (event.key === 'ri.theme' || event.key === null) {
        setTheme(validTheme(event.newValue) ? event.newValue : systemTheme())
      }
    }
    media.addEventListener('change', onSystemChange)
    window.addEventListener('storage', onStorage)
    return () => {
      media.removeEventListener('change', onSystemChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const toggleTheme = () => setTheme(current => {
    const next = current === 'dark' ? 'light' : 'dark'
    try { localStorage.setItem('ri.theme', next) } catch {}
    return next
  })
  return [theme, toggleTheme]
}
