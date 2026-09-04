import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import type { AuthIdentity } from "../../auth/authPort";
import type { SignOutStatus } from "../../auth/AuthProvider";
import "./CloudAppShell.css";

const PRIMARY_DESTINATIONS = [
  { to: "/", label: "Home", end: true },
  { to: "/todos", label: "Todos", end: false },
  { to: "/ideas", label: "Ideas", end: false },
  { to: "/media", label: "Media", end: false },
  { to: "/projects", label: "Projects", end: false },
] as const;

export interface CloudAppShellProps {
  readonly identity: AuthIdentity;
  readonly signOutStatus: SignOutStatus;
  readonly onSignOut: () => Promise<void>;
  readonly onOpenGlobalAdd: () => void;
  readonly globalAddDisabled?: boolean;
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
  children,
}: CloudAppShellProps) {
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
    <div className="cloud-shell">
      <a className="cloud-shell__skip-link" href="#cloud-main-content">
        Skip to main content
      </a>

      <header className="cloud-shell__header">
        <Link to="/" className="cloud-shell__wordmark">
          /orbitOS/
        </Link>

        <nav className="cloud-shell__nav" aria-label="Primary navigation">
          {PRIMARY_DESTINATIONS.map((destination) => (
            <NavLink
              key={destination.to}
              to={destination.to}
              end={destination.end}
              className={({ isActive }: { isActive: boolean }) =>
                `cloud-shell__nav-link${isActive ? " cloud-shell__nav-link--active" : ""}`
              }
            >
              {destination.label.toLowerCase()}
            </NavLink>
          ))}
        </nav>

        <div
          className="cloud-shell__actions"
          data-account-open={accountOpen}
        >
          <button
            className="cloud-shell__add"
            type="button"
            disabled={globalAddDisabled}
            onClick={onOpenGlobalAdd}
          >
            + add
          </button>

          <div className="cloud-shell__account" ref={accountRootRef}>
            <button
              ref={accountTriggerRef}
              className="cloud-shell__account-trigger"
              type="button"
              aria-expanded={accountOpen}
              aria-controls={accountOpen ? accountMenuId : undefined}
              onClick={() => setAccountOpen((open) => !open)}
            >
              account
              <span aria-hidden="true">{accountOpen ? "−" : "+"}</span>
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
                <Link
                  ref={settingsLinkRef}
                  className="cloud-shell__menu-item"
                  to="/settings"
                  onClick={() => setAccountOpen(false)}
                >
                  settings
                </Link>
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
      </header>

      <main id="cloud-main-content" className="cloud-shell__content" tabIndex={-1}>
        {children === undefined ? <Outlet /> : children}
      </main>
    </div>
  );
}

export default CloudAppShell;
