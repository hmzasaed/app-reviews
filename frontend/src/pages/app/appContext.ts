import { useOutletContext } from 'react-router'
import type { AppOut } from '../../types'

/** Shared state the app layout passes to its tab routes via <Outlet context>. */
export interface AppOutletContext {
  appId: string
  app: AppOut
  /** Bumped whenever a job completes; include it in fetch deps to refetch. */
  dataVersion: number
  /** True while a sync/analyze job is queued or running. */
  jobActive: boolean
  openSync: () => void
  openAnalyze: () => void
}

export const useAppOutlet = () => useOutletContext<AppOutletContext>()

export const appPath = (appId: string, sub = '') => `/apps/${encodeURIComponent(appId)}${sub ? `/${sub}` : ''}`
