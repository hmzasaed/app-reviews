import { createContext, useContext } from 'react'
import { humanize } from '../lib/format'
import type { CategoryMeta, MetaOut } from '../types'

export interface MetaContextValue {
  meta: MetaOut | undefined
  loading: boolean
  categories: CategoryMeta[]
  /** Category key -> display label (falls back to a humanized key). */
  categoryLabel: (key: string | null | undefined) => string
}

export const MetaContext = createContext<MetaContextValue>({
  meta: undefined,
  loading: true,
  categories: [],
  categoryLabel: (key) => (key ? humanize(key) : 'Uncategorized'),
})

export const useMeta = () => useContext(MetaContext)
