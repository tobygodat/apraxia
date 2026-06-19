import { useEffect, useState } from "react";
import { Route, Routes } from "react-router-dom";
import { api } from "./api/client";
import Layout from "./components/Layout";
import Login from "./components/Login";
import Books from "./pages/Books";
import Movies from "./pages/Movies";
import OrbitHome from "./pages/OrbitHome";
import Todos from "./pages/Todos";
import Writing from "./pages/Writing";

// Auth gate (spec §9): probe /api/me on load. null = checking, false = show
// login, true = render the app. With APP_PASSWORD unset, the backend reports
// authenticated and the login screen is skipped.
export default function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .me()
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false));
  }, []);

  if (authed === null) return <div className="center muted">Loading…</div>;
  if (!authed) return <Login onSuccess={() => setAuthed(true)} />;

  const logout = async () => {
    await api.logout();
    setAuthed(false);
  };

  return (
    <Routes>
      <Route path="/" element={<OrbitHome />} />
      <Route element={<Layout onLogout={logout} />}>
        <Route path="/todos" element={<Todos />} />
        <Route path="/writing" element={<Writing />} />
        <Route path="/books" element={<Books />} />
        <Route path="/movies" element={<Movies />} />
      </Route>
    </Routes>
  );
}
