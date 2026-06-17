import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";

// Generic read + delete list for the simpler sections (writing/books/movies/
// drafts). Todos has its own richer page. `primary` renders the row's label.
export default function ResourcePage<T extends { id: number }>({
  title,
  resource,
  primary,
}: {
  title: string;
  resource: string;
  primary: (row: T) => string;
}) {
  const [items, setItems] = useState<T[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api
      .list<T>(resource)
      .then(setItems)
      .catch((e) => setError(String(e)));
  }, [resource]);

  useEffect(() => load(), [load]);

  const remove = async (id: number) => {
    await api.remove(resource, id);
    load();
  };

  return (
    <section>
      <h1>{title}</h1>
      {error && <p className="error">{error}</p>}
      <ul className="list">
        {items.map((it) => (
          <li key={it.id} className="row">
            <span>{primary(it)}</span>
            <button className="link" onClick={() => remove(it.id)}>
              Delete
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="empty muted">Nothing here yet.</li>}
      </ul>
    </section>
  );
}
