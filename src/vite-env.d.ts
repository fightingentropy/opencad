/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_COLLAB_BACKEND_URL?: string;
  readonly VITE_ENABLE_ANONYMOUS_COLLAB?: 'true' | 'false';
}
