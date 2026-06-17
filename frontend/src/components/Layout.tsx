import { ReactNode } from "react";
import { NavLink } from "react-router-dom";

const SECTIONS = [
  { to: "/todos", label: "Todos" },
  { to: "/writing", label: "Writing" },
  { to: "/books", label: "Books" },
  { to: "/movies", label: "Movies" },
  { to: "/drafts", label: "Drafts" },
];

export default function Layout({
  children,
  onLogout,
}: {
  children: ReactNode;
  onLogout: () => void;
}) {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">tobiOS</div>
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
      <main className="content">{children}</main>
    </div>
  );
}
