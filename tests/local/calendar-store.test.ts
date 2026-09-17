import { expect, it } from "vitest";
import { createCalendarStore } from "../../server/calendar/calendarStore";

it("reads a missing Calendar connection as null through the real local Data API using its modern secret key", async () => {
  const url = process.env.APRAXIA_LOCAL_API;
  const publicKey = process.env.APRAXIA_LOCAL_PUBLIC_KEY;
  const secretKey = process.env.APRAXIA_LOCAL_SECRET_KEY;
  if (url !== "http://127.0.0.1:54321" || !publicKey || !secretKey?.startsWith("sb_secret_")) {
    throw new Error("The fixed local Supabase target with modern keys is required.");
  }
  const store = createCalendarStore(
    {
      APP_URL: "http://127.0.0.1:3000",
      SUPABASE_URL: url,
      VITE_SUPABASE_URL: url,
      SUPABASE_ANON_KEY: publicKey,
      VITE_SUPABASE_ANON_KEY: publicKey,
      SUPABASE_SERVICE_ROLE_KEY: secretKey,
    },
    new AbortController().signal,
  );
  // Read-only: no real user or credential row is needed to check SQL-null transport.
  expect(await store.read("00000000-0000-4000-8000-000000000001")).toBeNull();
});
