import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeSecureHttpOrigin } from "../../../shared/supabaseEnvironment";
import { getBrowserEnvironment } from "../config/browserEnv";
import { ServiceError } from "../lib/serviceError";

type OAuthClient = {
  readonly auth: Pick<SupabaseClient["auth"], "signInWithOAuth">;
};

/** No session, credentials, or provider response crosses this application port. */
export interface GoogleSignInPort {
  start(signal: AbortSignal): Promise<void>;
}

export interface GoogleSignInEnvironment {
  applicationOrigin(): string;
  supabaseOrigin(): string;
  navigate(url: string): void;
}

export const GOOGLE_SIGN_IN_ERROR =
  "Couldn’t open Google sign-in. Check your connection and try again.";

const browserEnvironment: GoogleSignInEnvironment = {
  applicationOrigin: () => globalThis.location.origin,
  supabaseOrigin: () => getBrowserEnvironment().supabaseUrl,
  navigate: (url) => globalThis.location.assign(url),
};

export function createGoogleSignInPort(
  client: OAuthClient,
  environment: GoogleSignInEnvironment = browserEnvironment,
): GoogleSignInPort {
  return {
    async start(signal) {
      if (signal.aborted) return;
      let stopWaiting: (() => void) | undefined;

      try {
        const applicationOrigin = normalizeSecureHttpOrigin(environment.applicationOrigin());
        const supabaseOrigin = normalizeSecureHttpOrigin(environment.supabaseOrigin());
        if (!applicationOrigin || !supabaseOrigin) throw new Error();

        const interrupted = new Promise<never>((_resolve, reject) => {
          const interrupt = () => reject(new Error());
          const timeout = setTimeout(interrupt, 15_000);
          signal.addEventListener("abort", interrupt, { once: true });
          stopWaiting = () => {
            clearTimeout(timeout);
            signal.removeEventListener("abort", interrupt);
          };
        });

        // Always return to this application's root. Never carry route, query,
        // hash, owner, or caller-supplied redirect values into the OAuth flow.
        const { data, error } = await Promise.race([
          client.auth.signInWithOAuth({
            provider: "google",
            options: {
              redirectTo: `${applicationOrigin}/`,
              scopes: "openid email profile",
              // The SDK still creates/stores PKCE. We own only the navigation
              // so a response cannot redirect a screen that has closed.
              skipBrowserRedirect: true,
            },
          }),
          interrupted,
        ]);

        if (signal.aborted) return;
        if (error || data.provider !== "google" || !data.url) throw new Error();

        const authorizationUrl = new URL(data.url);
        if (
          authorizationUrl.origin !== supabaseOrigin ||
          authorizationUrl.pathname !== "/auth/v1/authorize" ||
          authorizationUrl.username ||
          authorizationUrl.password ||
          authorizationUrl.hash
        ) {
          throw new Error();
        }

        // Preserve the SDK's complete URL, including its PKCE challenge.
        environment.navigate(data.url);
      } catch {
        if (signal.aborted) return;
        // Provider errors can contain URLs or credentials. Do not retain them
        // as a cause, log them, or expose them to application state.
        throw new ServiceError("unavailable", GOOGLE_SIGN_IN_ERROR);
      } finally {
        stopWaiting?.();
      }
    },
  };
}
