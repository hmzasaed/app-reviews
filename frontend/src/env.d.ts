/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the FastAPI service, e.g. "/api/v1" or "https://api.example.com/api/v1". */
  readonly VITE_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
