/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ORBITOS_RUNTIME?: "cloud" | "legacy";
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
