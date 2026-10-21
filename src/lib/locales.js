import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { cargarLocales, cacheLocales, duenoLocales, leerSeleccion, guardarSeleccion, nombreLocal, TODOS, EVENTO_LOCALES } from './localesBase.js'
export * from './localesBase.js'

// Hook para las pantallas: locales activos, el local del usuario y la selección del administrador.
export function useLocales(perfil) {
  const [info, setInfo] = useState(cacheLocales() || { habilitado: false, todos: [] })
  const [seleccionRaw, setSeleccionRaw] = useState(leerSeleccion)
  useEffect(() => {
    if (!perfil?.id || !supabase) return
    let vivo = true
    duenoLocales(perfil.id)
    const cargar = () => cargarLocales(supabase).then(v => { if (vivo) setInfo(v) })
    const alCambiar = () => { setSeleccionRaw(leerSeleccion()); cargar() }
    cargar()
    window.addEventListener(EVENTO_LOCALES, alCambiar)
    return () => { vivo = false; window.removeEventListener(EVENTO_LOCALES, alCambiar) }
  }, [perfil?.id])
  return useMemo(() => {
    const activos = info.todos.filter(l => l.activo)
    const multi = info.habilitado && activos.length > 1
    const esAdmin = perfil?.rol === 'admin'
    const miLocal = perfil?.local_id && activos.some(l => l.id === perfil.local_id) ? perfil.local_id : null
    // El vendedor siempre ve su local; el administrador elige «Todos» o uno.
    let seleccion = TODOS
    if (multi) {
      if (!esAdmin) seleccion = miLocal || activos[0]?.id
      else seleccion = seleccionRaw !== TODOS && activos.some(l => String(l.id) === seleccionRaw) ? Number(seleccionRaw) : TODOS
    }
    const filtro = multi && seleccion !== TODOS ? seleccion : null
    const localVenta = multi ? (esAdmin ? (filtro || miLocal || activos[0]?.id) : (miLocal || activos[0]?.id)) : null
    return {
      habilitado: info.habilitado, locales: activos, todos: info.todos, multi, miLocal,
      seleccion, filtro, localVenta,
      setSeleccion: guardarSeleccion,
      nombre: id => nombreLocal(info.todos, id),
      local: id => info.todos.find(l => String(l.id) === String(id)) || null,
    }
  }, [info, seleccionRaw, perfil?.id, perfil?.rol, perfil?.local_id])
}
