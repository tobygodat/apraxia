import ResourcePage from "../components/ResourcePage";
import type { Movie } from "../types";

export default function Movies() {
  return (
    <ResourcePage<Movie>
      title="Movies"
      resource="movies"
      primary={(m) => (m.year ? `${m.title} (${m.year})` : m.title)}
    />
  );
}
