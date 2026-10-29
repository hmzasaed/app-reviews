import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react'
import { isAbortError } from '../api/client'

export interface AsyncState<T> {
  data: T | undefined
  error: unknown
  loading: boolean
  /** Re-run the request with the same inputs. */
  reload: () => void
  /** Replace the cached data locally (e.g. after a PATCH returns the fresh object). */
  setData: (updater: T | ((prev: T | undefined) => T | undefined)) => void
}

/**
 * Run an async request whenever `deps` change. Previous data is kept while a
 * new request is in flight (so paginated lists don't flash), stale responses
 * are discarded, and the request is aborted on unmount.
 */
export function useAsync<T>(fn: (signal: AbortSignal) => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [data, setDataState] = useState<T | undefined>(undefined)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)

  // Always call the latest closure without making it an effect dependency.
  const fnRef = useRef(fn)
  useEffect(() => {
    fnRef.current = fn
  })

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    fnRef.current(controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return
        setDataState(result)
        setLoading(false)
      },
      (err: unknown) => {
        if (controller.signal.aborted || isAbortError(err)) return
        setError(err)
        setLoading(false)
      },
    )
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  const setData = useCallback((updater: T | ((prev: T | undefined) => T | undefined)) => {
    setDataState((prev) =>
      typeof updater === 'function' ? (updater as (p: T | undefined) => T | undefined)(prev) : updater,
    )
  }, [])

  return { data, error, loading, reload, setData }
}
