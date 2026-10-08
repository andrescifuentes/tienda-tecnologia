import { useRef, useState } from 'react'
import { toast } from './toast'
import { mensajeError } from './format'

// A ref locks synchronously, before React renders a disabled button.
export function useAction(action, onSettled) {
  const locked = useRef(false), [pending, setPending] = useState(false)
  const run = async (...args) => {
    if (locked.current) return
    locked.current = true; setPending(true)
    try { return await action(...args) }
    catch (error) { toast(mensajeError(error)) }
    finally { locked.current = false; setPending(false); onSettled?.() }
  }
  return [run, pending]
}
