import { Link, NavLink, Outlet } from "react-router-dom";

const SECTIONS = [
  { to: "/todos", label: "Todos" },
  { to: "/writing", label: "Writing" },
  { to: "/books", label: "Books" },
  { to: "/movies", label: "Movies" },
  { to: "/drafts", label: "Drafts" },
];

export default function Layout({
  onLogout,
}: {
  onLogout: () => void;
}) {
  return (
    <div className="app">
      <aside className="sidebar">
        <Link to="/" className="brand" style={{ textDecoration: "none", color: "inherit" }}>
          orbitOS
        </Link>
        <nav>
          {SECTIONS.map((s) => (
            <NavLink key={s.to} to={s.to} className="navlink">
              {s.label}
            </NavLink>
          ))}
        </nav>
        <button className="logout" onClick={onLogout}>
          Sign out
        </button>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
