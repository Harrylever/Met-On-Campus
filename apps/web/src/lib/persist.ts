import { useEffect, useState } from 'react'

/** useState that survives leaving the screen and reloading the tab (this tab only). Storage can be blocked, so it is only ever a convenience. */
export function usePersisted<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try { const raw = sessionStorage.getItem(key); return raw == null ? initial : (JSON.parse(raw) as T) } catch { return initial }
  })
  useEffect(() => { try { sessionStorage.setItem(key, JSON.stringify(value)) } catch { /* fine */ } }, [key, value])
  return [value, setValue] as const
}

/** The value, but only after it has stopped changing for `ms` (for search boxes that call the server). */
export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}
