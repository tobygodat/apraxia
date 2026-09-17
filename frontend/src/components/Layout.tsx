import { Link, NavLink, Outlet } from "react-router-dom";

const SECTIONS = [
  { to: "/", label: "Home", end: true },
  { to: "/todos", label: "Todos" },
  { to: "/ideas", label: "Ideas" },
  { to: "/projects", label: "Projects" },
];

export default function Layout({ onLogout }: { onLogout: () => void }) {
  return (
    <div className="orbit-shell">
      <header className="orbit-shell__header">
        <Link to="/" className="orbit-shell__wordmark">
          /apraxia/
        </Link>
        <nav className="orbit-shell__nav" aria-label="Primary navigation">
          {SECTIONS.map((section) => (
            <NavLink
              key={section.to}
              to={section.to}
              end={section.end}
              className="orbit-shell__link"
            >
              {section.label.toLowerCase()}
            </NavLink>
          ))}
        </nav>
        <div className="orbit-shell__actions">
          <Link to="/todos" className="orbit-shell__add">
            + add
          </Link>
          <button className="orbit-shell__logout" type="button" onClick={onLogout}>
            sign out
          </button>
        </div>
      </header>
      <main className="orbit-shell__content">
        <Outlet />
      </main>
    </div>
  );
}
