import ResourcePage from "../components/ResourcePage";
import type { Book } from "../types";

export default function Books() {
  return (
    <ResourcePage<Book>
      title="Books"
      resource="books"
      primary={(b) => (b.author ? `${b.title} — ${b.author}` : b.title)}
    />
  );
}
