import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import type { AuthIdentity } from "../../auth/authPort";
import type { SignOutStatus } from "../../auth/AuthProvider";
import { useWorkspacePreferences } from "../../apps/workspacePreferences";
import { useColdLoadState } from "../../apps/coldLoad";
import { WorkspaceIcon } from "../WorkspaceIcon";
import "./CloudAppShell.css";
import "./CloudAppShellPaper.css";

/** Delay before showing the indeterminate bar, so fast loads never flash it. */
const LOADING_BAR_DELAY_MS = 150;

/**
 * Thin indeterminate progress bar fixed to the top of the shell. Shown only
 * once any mounted cold-load gate has been loading for at least
 * `LOADING_BAR_DELAY_MS`, and hidden once nothing is loading any more —
 * including a stuck load that revealed its content via its timeout but is
 * still fetching, so the bar keeps running rather than the app going quiet.
 * Purely decorative: pages already announce their own loading/ready state,
 * so this stays out of the accessibility tree.
 */
function LoadingBar() {
  const { pending } = useColdLoadState();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!pending) {
      setVisible(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setVisible(true), LOADING_BAR_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [pending]);

  if (!visible) return null;
  return <div className="cloud-shell__loading-bar" aria-hidden="true" />;
}

const PRIMARY_DESTINATIONS = [
  { to: "/", label: "Home", icon: "home", end: true },
  { to: "/todos", label: "Tasks", icon: "todos", end: false },
  { to: "/ideas", label: "Ideas", icon: "ideas", end: false },
  { to: "/projects", label: "Projects", icon: "projects", end: false },
  { to: "/classes", label: "Classes", icon: "classes", end: false },
  { to: "/career", label: "Career", icon: "career", end: false },
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
  const [accountOpen, setAccountOpen] = useState(false);
  const accountMenuId = useId();
  const navId = useId();
  const accountRootRef = useRef<HTMLDivElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsLinkRef = useRef<HTMLAnchorElement>(null);
  const signOutButtonRef = useRef<HTMLButtonElement>(null);
  const email = identity.email?.trim() || null;
  const { preferences, setSidebarCollapsed } = useWorkspacePreferences();
  const collapsed = preferences.sidebarCollapsed;

  useEffect(() => {
    if (!accountOpen) return;

    const closeAndReturnFocus = () => {
      setAccountOpen(false);
      accountTriggerRef.current?.focus();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !accountRootRef.current?.contains(event.target)) {
        setAccountOpen(false);
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !accountRootRef.current?.contains(event.target)) {
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
      const currentIndex = items.findIndex((item) => item === document.activeElement);
      let nextIndex: number | null = null;

      if (event.key === "ArrowDown") {
        nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
      } else if (event.key === "ArrowUp") {
        nextIndex =
          currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
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
    <div
      className="cloud-shell"
      aria-busy={signOutStatus === "pending"}
      data-sidebar-collapsed={collapsed ? "true" : undefined}
    >
      <LoadingBar />
      <a className="cloud-shell__skip-link" href="#cloud-main-content">
        Skip to main content
      </a>

      <aside className="cloud-shell__sidebar" aria-label="Workspace sidebar">
        <div className="cloud-shell__brand-row">
          <Link to="/" className="cloud-shell__wordmark">
            <img
              className="cloud-shell__mark"
              src="/brand/apraxia-mark-96.png"
              alt=""
              width={25}
              height={25}
            />
            <span>apraxia</span>
          </Link>
        </div>

        {onOpenSearch ? (
          <button className="cloud-shell__search" type="button" onClick={onOpenSearch}>
            <WorkspaceIcon name="search" />
            <span>Search</span>
            <kbd aria-hidden="true">Ctrl K</kbd>
          </button>
        ) : null}

        <nav id={navId} className="cloud-shell__nav" aria-label="Primary navigation">
          {PRIMARY_DESTINATIONS.filter(
            (destination) =>
              !availableDestinations || availableDestinations.includes(destination.to),
          ).map((destination) => (
            <NavLink
              key={destination.to}
              to={destination.to}
              end={destination.end}
              title={collapsed ? destination.label.toLowerCase() : undefined}
              className={({ isActive }: { isActive: boolean }) =>
                `cloud-shell__nav-link${isActive ? " cloud-shell__nav-link--active" : ""}`
              }
            >
              <WorkspaceIcon name={destination.icon} />
              <span>{destination.label.toLowerCase()}</span>
            </NavLink>
          ))}
        </nav>

        <button
          type="button"
          className="cloud-shell__collapse-toggle"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          aria-controls={navId}
          onClick={() => setSidebarCollapsed(!collapsed)}
        >
          <svg
            className="cloud-shell__collapse-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <div className="cloud-shell__actions" data-account-open={accountOpen}>
          <button
            className="cloud-shell__add"
            type="button"
            disabled={globalAddDisabled}
            onClick={onOpenGlobalAdd}
            aria-label="+ add"
            title="Add"
          >
            <WorkspaceIcon name="plus" />
            <span>add</span>
          </button>
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
              <span className="cloud-shell__avatar" aria-hidden="true">
                o
              </span>
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
                {settingsAvailable ? (
                  <Link
                    ref={settingsLinkRef}
                    className="cloud-shell__menu-item"
                    to="/settings"
                    onClick={() => setAccountOpen(false)}
                  >
                    settings
                  </Link>
                ) : null}
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
          <p className="cloud-shell__sr-only" role="status" aria-live="polite">
            {signOutStatus === "pending" ? "Signing out and closing this private workspace." : ""}
          </p>
        </div>
      </aside>

      <div className="cloud-shell__body">
        <main id="cloud-main-content" className="cloud-shell__content" tabIndex={-1}>
          {children === undefined ? <Outlet /> : children}
        </main>
      </div>
    </div>
  );
}
