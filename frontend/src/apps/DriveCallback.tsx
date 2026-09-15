import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Link, useNavigate } from "react-router-dom";
import type { Database } from "../types/database";

export type DriveCallbackInput =
  { state: string; code: string } | { state: string; error: "access_denied" };

export function parseDriveHandoff(hash: string): DriveCallbackInput | null {
  const values = new URLSearchParams(hash.replace(/^#/, ""));
  const state = values.get("state");
  if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state) || values.getAll("state").length !== 1)
    return null;
  if (values.has("error")) {
    return values.get("error") === "access_denied" &&
      values.getAll("error").length === 1 &&
      !values.has("code")
      ? { state, error: "access_denied" }
      : null;
  }
  const code = values.get("code");
  return code && /^[\x21-\x7e]{1,4096}$/.test(code) && values.getAll("code").length === 1
    ? { state, code }
    : null;
}

// Read once before the Supabase client inspects location. Keep the code only in
// memory; neither browser history nor session/local storage receives it.
let handoff: DriveCallbackInput | null = null;
if (typeof window !== "undefined" && window.location.pathname === "/drive/callback") {
  handoff = parseDriveHandoff(window.location.hash);
  window.history.replaceState(window.history.state, "", "/drive/callback");
}

export async function finishDriveHandoff(
  client: SupabaseClient<Database>,
  userId: string,
  input: DriveCallbackInput,
): Promise<boolean> {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session || data.session.user.id !== userId) throw new Error("session_changed");
  const response = await fetch("/api/drive/complete", {
    method: "POST",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(30_000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${data.session.access_token}`,
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error("connection_failed");
  const result = (await response.json()) as { connected?: boolean; denied?: boolean };
  if (result.connected === true) return true;
  if (result.connected === false && result.denied === true) return false;
  throw new Error("connection_failed");
}

export function DriveCallback({
  client,
  userId,
  input = handoff,
}: {
  client: SupabaseClient<Database>;
  userId: string;
  input?: DriveCallbackInput | null;
}) {
  const navigate = useNavigate();
  const [pendingInput] = useState(input);
  const [failed, setFailed] = useState(false);
  const request = useRef<Promise<boolean> | null>(null);
  useEffect(() => {
    let active = true;
    if (!pendingInput) {
      setFailed(true);
      return;
    }
    // StrictMode replays effects; the one-time code must be submitted only once.
    request.current ??= finishDriveHandoff(client, userId, pendingInput);
    handoff = null;
    void request.current
      .then((connected) => {
        if (active)
          navigate(`/classes?drive=${connected ? "connected" : "cancelled"}`, { replace: true });
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [client, pendingInput, navigate, userId]);
  return (
    <main className="auth-screen">
      <section className="auth-card">
        <h1>{failed ? "Drive wasn’t connected" : "Connecting Drive…"}</h1>
        {failed ? (
          <>
            <p className="auth-card__copy" role="alert">
              Start the connection again from Classes.{" "}
            </p>
            <Link className="auth-card__button" to="/classes">
              Open Classes
            </Link>
          </>
        ) : (
          <p className="auth-card__copy" role="status">
            Finishing the connection securely.
          </p>
        )}
      </section>
    </main>
  );
}
