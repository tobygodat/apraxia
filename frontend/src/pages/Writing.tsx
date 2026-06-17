import ResourcePage from "../components/ResourcePage";
import type { Writing } from "../types";

export default function WritingPage() {
  return (
    <ResourcePage<Writing>
      title="Writing"
      resource="writing"
      primary={(w) => w.title || w.body.slice(0, 80)}
    />
  );
}
