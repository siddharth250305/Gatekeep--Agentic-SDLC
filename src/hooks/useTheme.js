import { useEffect, useState } from 'react'

// Light / dark mode. Follows the OS setting until the user picks one; only an
// explicit choice is saved.
export function useTheme() {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    try {
      if (typeof document !== 'undefined') {
        const saved = localStorage.getItem('gatekeep_theme')
        if (saved === 'dark') return true
        if (saved === 'light') return false
        if (document.documentElement.classList.contains('dark')) return true
      }
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    } catch {
      return false
    }
  })

  useEffect(() => {
    try {
      document.documentElement.classList.toggle('dark', isDarkMode)
      document.body.classList.toggle('dark', isDarkMode)
      document.documentElement.style.colorScheme = isDarkMode ? 'dark' : 'light'
    } catch { /* no DOM */ }
  }, [isDarkMode])

  useEffect(() => {
    try {
      const media = window.matchMedia('(prefers-color-scheme: dark)')
      const listener = (e) => {
        if (!localStorage.getItem('gatekeep_theme')) setIsDarkMode(e.matches)
      }
      if (media?.addEventListener) {
        media.addEventListener('change', listener)
        return () => media.removeEventListener('change', listener)
      }
    } catch { /* no matchMedia */ }
    return undefined
  }, [])

  const toggleTheme = () => setIsDarkMode((prev) => {
    try { localStorage.setItem('gatekeep_theme', prev ? 'light' : 'dark') } catch { /* storage unavailable */ }
    return !prev
  })

  return { isDarkMode, toggleTheme }
}
