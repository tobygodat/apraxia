import ResourcePage from "../components/ResourcePage";
import type { Draft } from "../types";

// The outbox (spec §4e): read the agent's approved drafts, copy, send manually.
export default function Drafts() {
  return (
    <ResourcePage<Draft>
      title="Drafts"
      resource="drafts"
      primary={(d) => `[${d.kind}] ${d.body.slice(0, 80)}`}
    />
  );
}
