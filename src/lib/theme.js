const valid = value => value === 'light' || value === 'dark'
export function getTheme() { return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark' }
export function setTheme(theme, persist = true) {
  const next = valid(theme) ? theme : 'dark'
  document.documentElement.dataset.theme = next
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', next === 'dark' ? '#090909' : '#f4f0e8')
  if (persist) { try { localStorage.setItem('tema', next); localStorage.setItem('theme', next) } catch { /* Preference is optional. */ } }
  window.dispatchEvent(new Event('app-theme-change'))
}
export function initializeTheme() {
  let saved
  try { const current = localStorage.getItem('theme'), legacy = localStorage.getItem('tema'); saved = valid(current) ? current : legacy } catch { /* Dark remains the default. */ }
  setTheme(valid(saved) ? saved : 'dark', false)
}
