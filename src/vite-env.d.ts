/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Shared room relay base URL, e.g. http://127.0.0.1:45322 */
  readonly VITE_RELAY_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
