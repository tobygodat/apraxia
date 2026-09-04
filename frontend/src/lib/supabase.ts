import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createProviderSafeStorage } from "../auth/providerSafeStorage";
import { getBrowserEnvironment } from "../config/browserEnv";

let browserClient: SupabaseClient | undefined;

export function getBrowserSupabaseClient(): SupabaseClient {
  if (browserClient) return browserClient;

  const environment = getBrowserEnvironment();
  browserClient = createClient(
    environment.supabaseUrl,
    environment.supabaseAnonKey,
    {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        flowType: "pkce",
        storage: createProviderSafeStorage(globalThis.localStorage),
      },
    },
  );

  return browserClient;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    const client = browserClient;
    browserClient = undefined;
    if (client) void client.auth.dispose();
  });
}
