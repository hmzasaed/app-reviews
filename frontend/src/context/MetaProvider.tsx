import { useMemo, type ReactNode } from 'react'
import { getMeta } from '../api/client'
import { useAsync } from '../hooks/useAsync'
import { humanize } from '../lib/format'
import { MetaContext, type MetaContextValue } from './meta'

/** Loads GET /meta once (category labels, statuses, LLM info) for the whole app. */
export function MetaProvider({ children }: { children: ReactNode }) {
  const { data, loading } = useAsync((signal) => getMeta(signal), [])

  const value = useMemo<MetaContextValue>(() => {
    const categories = data?.categories ?? []
    const byKey = new Map(categories.map((c) => [c.key, c.label]))
    return {
      meta: data,
      loading,
      categories,
      categoryLabel: (key) => (key ? (byKey.get(key) ?? humanize(key)) : 'Uncategorized'),
    }
  }, [data, loading])

  return <MetaContext.Provider value={value}>{children}</MetaContext.Provider>
}
