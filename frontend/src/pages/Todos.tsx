import { FormEvent, useEffect, useState } from "react";
import { api } from "../api/client";
import type { Todo } from "../types";

// The fully worked example page: list + add + toggle done + delete.
export default function Todos() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  const load = () =>
    api
      .list<Todo>("todos")
      .then(setTodos)
      .catch((e) => setError(String(e)));

  useEffect(() => {
    load();
  }, []);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    await api.create<Todo>("todos", { text: text.trim() });
    setText("");
    load();
  };

  const toggle = async (t: Todo) => {
    await api.update<Todo>("todos", t.id, { done: t.done ? 0 : 1 });
    load();
  };

  const remove = async (id: number) => {
    await api.remove("todos", id);
    load();
  };

  return (
    <section>
      <h1>Todos</h1>
      <form className="addform" onSubmit={add}>
        <input
          placeholder="Add a todo…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit">Add</button>
      </form>
      {error && <p className="error">{error}</p>}
      <ul className="list">
        {todos.map((t) => (
          <li key={t.id} className="row">
            <label className={t.done ? "done" : ""}>
              <input type="checkbox" checked={!!t.done} onChange={() => toggle(t)} />
              {t.text}
            </label>
            <button className="link" onClick={() => remove(t.id)}>
              Delete
            </button>
          </li>
        ))}
        {todos.length === 0 && <li className="empty muted">No todos yet.</li>}
      </ul>
    </section>
  );
}
