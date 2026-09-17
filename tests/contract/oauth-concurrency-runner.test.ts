import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

// Importing the runner exercises pure safety guards, never Docker or PostgreSQL.
const runnerUrl = pathToFileURL(
  path.join(process.cwd(), "scripts/check-oauth-concurrency.mjs"),
).href;
const { assertLocalDockerEndpoint, assertLocalContainer, assertDatabaseIdentity } = await import(
  runnerUrl
);

const localContainer = {
  name: "/supabase_db_apraxia",
  id: "a".repeat(64),
  running: true,
  labels: { "com.supabase.cli.project": "apraxia" },
  image: "public.ecr.aws/supabase/postgres:17.6.1.063",
};
const localDatabase = {
  database: "postgres",
  user: "postgres",
  socket: true,
  version: 170006,
  migration: true,
  begin_function: true,
  consume_function: true,
};

describe("local OAuth concurrency runner safety guards (not concurrency proof)", () => {
  it.each(["npipe:////./pipe/dockerDesktopLinuxEngine", "unix:///var/run/docker.sock"])(
    "accepts local Docker endpoint %s",
    (endpoint) => {
      expect(assertLocalDockerEndpoint(endpoint)).toBe(endpoint);
    },
  );

  it.each([
    "ssh://remote",
    "tcp://localhost:2375",
    "https://docker.example.test",
    "npipe:////remote/pipe/docker",
    "unix://remote/docker.sock",
    "",
    null,
  ])("rejects nonlocal or ambiguous Docker endpoint %s", (endpoint) => {
    expect(() => assertLocalDockerEndpoint(endpoint)).toThrow();
  });

  it("accepts only a verified running project container with a pinned immutable ID", () => {
    expect(assertLocalContainer(localContainer)).toBe(localContainer.id);
  });

  it.each([
    { name: "/supabase_db_other" },
    { id: "supabase_db_apraxia" },
    { running: false },
    { labels: {} },
    { labels: { "com.supabase.cli.project": "production" } },
    { image: "supabase/postgres:16.4" },
    { image: "attacker/supabase/postgres:17.6" },
  ])("rejects a mismatching container projection %j", (change) => {
    expect(() => assertLocalContainer({ ...localContainer, ...change })).toThrow();
  });

  it("identifies a container mismatch without logging other Docker metadata", () => {
    const container = {
      ...localContainer,
      running: false,
      labels: { ...localContainer.labels, secret: "do-not-log-label" },
      env: ["PASSWORD=do-not-log-env"],
    };
    expect(() => assertLocalContainer(container)).toThrow("Mismatched: running.");
    try {
      assertLocalContainer(container);
    } catch (error) {
      expect(String(error)).not.toContain("do-not-log");
    }
  });

  it("accepts the expected socket database and applied OAuth migration", () => {
    expect(() => assertDatabaseIdentity(localDatabase)).not.toThrow();
  });

  it.each([
    { database: "production" },
    { user: "service_role" },
    { socket: false },
    { version: 160006 },
    { version: 180000 },
    { version: "170006" },
    { migration: false },
    { begin_function: false },
    { consume_function: false },
  ])("rejects mismatching database identity %j", (change) => {
    expect(() => assertDatabaseIdentity({ ...localDatabase, ...change })).toThrow();
  });
});
