import { useEffect, useState } from 'react'
import { isDemoMode } from '../supabase'
import { DEMO_KEY } from './seed'

// Event-driven invalidation. Burst writes are coalesced, with no polling.
export function subscribeDemoChanges(callback) {
  let timer
  const changed = () => { clearTimeout(timer); timer = setTimeout(callback, 20) }
  const stored = event => { if (event.key === DEMO_KEY || event.key === null) changed() }
  window.addEventListener('demo-data-change', changed)
  window.addEventListener('storage', stored)
  return () => { clearTimeout(timer); window.removeEventListener('demo-data-change', changed); window.removeEventListener('storage', stored) }
}

export function useDemoRevision() {
  const [revision, setRevision] = useState(0)
  useEffect(() => isDemoMode ? subscribeDemoChanges(() => setRevision(r => r + 1)) : undefined, [])
  return revision
}
