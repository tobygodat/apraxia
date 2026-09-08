import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import type { AuthIdentity } from "../../auth/authPort";
import type { SignOutStatus } from "../../auth/AuthProvider";
import { WorkspaceIcon } from "../WorkspaceIcon";
import "./CloudAppShell.css";

const PRIMARY_DESTINATIONS = [
  { to: "/", label: "Home", icon: "home", end: true },
  { to: "/todos", label: "Tasks", icon: "todos", end: false },
  { to: "/ideas", label: "Ideas", icon: "ideas", end: false },
  { to: "/media", label: "Media", icon: "media", end: false },
  { to: "/projects", label: "Projects", icon: "projects", end: false },
] as const;

export interface CloudAppShellProps {
  readonly identity: AuthIdentity;
  readonly signOutStatus: SignOutStatus;
  readonly onSignOut: () => Promise<void>;
  readonly onOpenGlobalAdd: () => void;
  readonly globalAddDisabled?: boolean;
  readonly onOpenSearch?: () => void;
  readonly availableDestinations?: readonly string[];
  readonly settingsAvailable?: boolean;
  /**
   * Tests and self-contained surfaces may provide content directly. When this
   * prop is omitted, the shell renders the router's nested route outlet.
   */
  readonly children?: ReactNode;
}

export function CloudAppShell({
  identity,
  signOutStatus,
  onSignOut,
  onOpenGlobalAdd,
  globalAddDisabled = false,
  onOpenSearch,
  availableDestinations,
  settingsAvailable = true,
  children,
}: CloudAppShellProps) {
  const { pathname } = useLocation();
  const currentDestination = PRIMARY_DESTINATIONS.find(destination => destination.to === "/" ? pathname === "/" : pathname === destination.to || pathname.startsWith(`${destination.to}/`));
  const pageLabel = currentDestination?.label ?? (pathname === "/settings" ? "Settings" : "Workspace");
  const [accountOpen, setAccountOpen] = useState(false);
  const accountMenuId = useId();
  const accountRootRef = useRef<HTMLDivElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsLinkRef = useRef<HTMLAnchorElement>(null);
  const signOutButtonRef = useRef<HTMLButtonElement>(null);
  const email = identity.email?.trim() || null;

  useEffect(() => {
    if (!accountOpen) return;

    const closeAndReturnFocus = () => {
      setAccountOpen(false);
      accountTriggerRef.current?.focus();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !accountRootRef.current?.contains(event.target)
      ) {
        setAccountOpen(false);
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (
        event.target instanceof Node &&
        !accountRootRef.current?.contains(event.target)
      ) {
        setAccountOpen(false);
      }
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAndReturnFocus();
        return;
      }

      const items = [settingsLinkRef.current, signOutButtonRef.current].filter(
        (item): item is HTMLAnchorElement | HTMLButtonElement =>
          item !== null && !item.hasAttribute("disabled"),
      );
      const currentIndex = items.findIndex(
        (item) => item === document.activeElement,
      );
      let nextIndex: number | null = null;

      if (event.key === "ArrowDown") {
        nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
      } else if (event.key === "ArrowUp") {
        nextIndex =
          currentIndex < 0
            ? items.length - 1
            : (currentIndex - 1 + items.length) % items.length;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = items.length - 1;
      }

      const nextItem = nextIndex === null ? undefined : items[nextIndex];
      if (nextItem) {
        event.preventDefault();
        nextItem.focus();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("keydown", handleKeyDown);
    settingsLinkRef.current?.focus();

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [accountOpen]);

  const requestSignOut = () => {
    // AuthProvider owns failure state. Swallowing here prevents a rejected
    // adapter promise from becoming an unhandled browser rejection.
    void onSignOut().catch(() => undefined);
  };

  return (
    <div className="cloud-shell" aria-busy={signOutStatus === "pending"}>
      <a className="cloud-shell__skip-link" href="#cloud-main-content">
        Skip to main content
      </a>

      <aside className="cloud-shell__sidebar" aria-label="Workspace sidebar">
        <Link to="/" className="cloud-shell__wordmark">
          <WorkspaceIcon name="orbit" />
          <span>orbitOS</span>
        </Link>

        {onOpenSearch ? <button className="cloud-shell__search" type="button" onClick={onOpenSearch}>
          <WorkspaceIcon name="search" /><span>Search</span><kbd aria-hidden="true">Ctrl K</kbd>
        </button> : null}

        <nav className="cloud-shell__nav" aria-label="Primary navigation">
          {PRIMARY_DESTINATIONS.filter((destination) => !availableDestinations || availableDestinations.includes(destination.to)).map((destination) => (
            <NavLink
              key={destination.to}
              to={destination.to}
              end={destination.end}
              className={({ isActive }: { isActive: boolean }) =>
                `cloud-shell__nav-link${isActive ? " cloud-shell__nav-link--active" : ""}`
              }
            >
              <WorkspaceIcon name={destination.icon} />
              <span>{destination.label.toLowerCase()}</span>
            </NavLink>
          ))}
        </nav>

        <div
          className="cloud-shell__actions"
          data-account-open={accountOpen}
        >
          <div className="cloud-shell__account" ref={accountRootRef}>
            <button
              ref={accountTriggerRef}
              className="cloud-shell__account-trigger"
              type="button"
              aria-label="account"
              aria-expanded={accountOpen}
              aria-controls={accountOpen ? accountMenuId : undefined}
              onClick={() => setAccountOpen((open) => !open)}
            >
              <span className="cloud-shell__avatar" aria-hidden="true">o</span>
              <span>Account</span>
              <WorkspaceIcon name="down" />
            </button>

            {accountOpen ? (
              <div
                id={accountMenuId}
                className="cloud-shell__account-menu"
                role="group"
                aria-label="Account options"
              >
                {email ? (
                  <p className="cloud-shell__account-email" title={email}>
                    {email}
                  </p>
                ) : (
                  <p className="cloud-shell__account-email">Signed in</p>
                )}
                {settingsAvailable ? <Link
                  ref={settingsLinkRef}
                  className="cloud-shell__menu-item"
                  to="/settings"
                  onClick={() => setAccountOpen(false)}
                >
                  settings
                </Link> : null}
                <button
                  ref={signOutButtonRef}
                  className="cloud-shell__menu-item cloud-shell__sign-out"
                  type="button"
                  disabled={signOutStatus === "pending"}
                  onClick={requestSignOut}
                >
                  {signOutStatus === "pending" ? "Signing out…" : "sign out"}
                </button>
              </div>
            ) : null}
          </div>

          {signOutStatus === "error" ? (
            <p className="cloud-shell__sign-out-error" role="alert">
              Couldn’t sign out. Your workspace remains open. Try again.
            </p>
          ) : null}
          <p
            className="cloud-shell__sr-only"
            role="status"
            aria-live="polite"
          >
            {signOutStatus === "pending"
              ? "Signing out and closing this private workspace."
              : ""}
          </p>
        </div>
      </aside>

      <div className="cloud-shell__body">
        <header className="cloud-shell__header">
          <div className="cloud-shell__breadcrumb">
            <WorkspaceIcon name={currentDestination?.icon ?? "home"} />
            <span>Workspace</span><span aria-hidden="true">/</span><span>{pageLabel}</span>
          </div>
          <button className="cloud-shell__add" type="button" disabled={globalAddDisabled} onClick={onOpenGlobalAdd} aria-label="+ add">
            <WorkspaceIcon name="plus" /><span>Add</span>
          </button>
        </header>

        <main id="cloud-main-content" className="cloud-shell__content" tabIndex={-1}>
          {children === undefined ? <Outlet /> : children}
        </main>
      </div>
    </div>
  );
}

export default CloudAppShell;
