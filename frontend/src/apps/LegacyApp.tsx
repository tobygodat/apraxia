import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api } from "../api/client";
import Layout from "../components/Layout";
import Login from "../components/Login";
import OrbitHome from "../pages/OrbitHome";
import Projects from "../pages/Projects";
import Todos from "../pages/Todos";
import Writing from "../pages/Writing";
import "../pages/legacy.css";

// Recoverable access to the transitional FastAPI application. Cloud builds do
// not import or render this tree unless VITE_ORBITOS_RUNTIME=legacy is explicit.
export default function LegacyApp() {
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
      <Route element={<Layout onLogout={logout} />}>
        <Route index element={<OrbitHome />} />
        <Route path="/todos" element={<Todos />} />
        <Route path="/ideas" element={<Writing />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/writing" element={<Navigate to="/ideas" replace />} />
      </Route>
    </Routes>
  );
}
