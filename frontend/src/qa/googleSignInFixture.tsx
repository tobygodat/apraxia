import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ConfiguredCloudApp } from "../apps/CloudApp";
import type { GoogleSignInPort } from "../auth/googleSignIn";
import "../index.css";
import "./googleSignInFixture.css";

if (!import.meta.env.DEV) throw new Error("The QA fixture is development-only.");

// No real account, environment, storage, or provider is used in this fixture.
const client = {
  auth: {
    async getSession() {
      return { data: { session: null }, error: null };
    },
    onAuthStateChange() {
      return { data: { subscription: { unsubscribe() {} } } };
    },
    async signOut() {
      return { error: null };
    },
  },
} as unknown as SupabaseClient;

const port: GoogleSignInPort = {
  async start(signal) {
    await new Promise<void>((resolve, reject) => {
      const cancelled = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", cancelled);
        reject(new DOMException("Fixture cancelled", "AbortError"));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", cancelled);
        resolve();
      }, 800);
      if (signal.aborted) cancelled();
      else signal.addEventListener("abort", cancelled, { once: true });
    });
    throw new Error("Fictional provider failure; no network request was made.");
  },
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <aside className="qa-sign-in-note">
      Local preview · The button simulates a connection failure. It does not open Google or sign in.
    </aside>
    <MemoryRouter>
      <ConfiguredCloudApp client={client} googleSignInPort={port} />
    </MemoryRouter>
  </StrictMode>,
);
