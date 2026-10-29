import { createBrowserRouter, RouterProvider } from 'react-router'
import { Spinner } from './components/ui/States'
import { MetaProvider } from './context/MetaProvider'
import { ToastProvider } from './context/ToastProvider'
import { AppsHome } from './pages/AppsHome'
import { NotFound, RouteError } from './pages/NotFound'
import { RootLayout } from './pages/RootLayout'

// App pages pull in Recharts; load them on demand to keep the first load small.
const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <RouteError />,
    // Shown while a lazily loaded route resolves on the very first page load.
    hydrateFallbackElement: <Spinner label="Loading dashboard…" className="min-h-screen" />,
    children: [
      { index: true, element: <AppsHome /> },
      {
        path: 'apps/:appId',
        lazy: async () => ({ Component: (await import('./pages/app/AppLayout')).AppLayout }),
        children: [
          { index: true, lazy: async () => ({ Component: (await import('./pages/app/OverviewTab')).OverviewTab }) },
          { path: 'issues', lazy: async () => ({ Component: (await import('./pages/app/IssuesTab')).IssuesTab }) },
          {
            path: 'issues/:issueId',
            lazy: async () => ({ Component: (await import('./pages/app/IssueDetailPage')).IssueDetailPage }),
          },
          { path: 'insights', lazy: async () => ({ Component: (await import('./pages/app/InsightsTab')).InsightsTab }) },
          { path: 'reviews', lazy: async () => ({ Component: (await import('./pages/app/ReviewsTab')).ReviewsTab }) },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
])

export default function App() {
  return (
    <ToastProvider>
      <MetaProvider>
        <RouterProvider router={router} />
      </MetaProvider>
    </ToastProvider>
  )
}
