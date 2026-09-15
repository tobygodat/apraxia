import {
  forwardRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useLayoutEffect,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { useDialogPresence } from "../../apps/workspaceStore";
import "./Dialog.css";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "a[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** True when nothing meaningful holds focus (no element, or the document itself). */
export function isDocumentFocus(element: Element | null): boolean {
  return element === null || element === document.body || element === document.documentElement;
}

/** Tab-reachable descendants, honouring roving `tabindex="-1"` on native controls. */
function focusableWithin(root: ParentNode | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hidden && element.getAttribute("tabindex") !== "-1",
  );
}

export interface DialogKeyOptions {
  readonly onClose: () => void;
  /** Escape is swallowed but ignored while a write is pending. */
  readonly closeLocked?: boolean;
  /** Set false for popovers whose Tab should leave instead of cycling. */
  readonly trapTab?: boolean;
}

/** Escape closes; Tab cycles inside `root`. Shared by modal and popover surfaces. */
export function dialogKeyDown(
  event: KeyboardEvent<HTMLElement>,
  root: HTMLElement | null,
  { onClose, closeLocked = false, trapTab = true }: DialogKeyOptions,
): void {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    if (!closeLocked) onClose();
    return;
  }
  if (event.key !== "Tab" || !trapTab || !root) return;
  const items = focusableWithin(root);
  const first = items[0];
  const last = items[items.length - 1];
  if (!first || !last) {
    event.preventDefault();
    root.focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export interface DialogFocusOptions {
  readonly open?: boolean;
  /** Focused on open; otherwise `[data-autofocus]`, then the first control, then the root. */
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  /** Used when closing has removed the opener (for example a rescheduled row). */
  readonly fallbackFocusRef?: RefObject<HTMLElement | null>;
  readonly lockScroll?: boolean;
}

/**
 * Initial focus on open and focus restoration on close. Restoration waits one
 * microtask so a newer dialog or a newer focused control always wins.
 */
export function useDialogFocus(
  ref: RefObject<HTMLElement | null>,
  { open = true, initialFocusRef, fallbackFocusRef, lockScroll = true }: DialogFocusOptions,
): void {
  const latest = useRef({ initialFocusRef, fallbackFocusRef });
  latest.current = { initialFocusRef, fallbackFocusRef };
  useLayoutEffect(() => {
    if (!open) return;
    const root = ref.current;
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && !isDocumentFocus(active) ? active : null;
    const previousOverflow = document.body.style.overflow;
    if (lockScroll) document.body.style.overflow = "hidden";
    let ownsFocus = true;
    const trackOwnership = (event: FocusEvent) => {
      if (isDocumentFocus(event.target as Element | null)) return;
      ownsFocus = event.target instanceof Node && Boolean(root?.contains(event.target));
    };
    document.addEventListener("focusin", trackOwnership);
    const initial =
      latest.current.initialFocusRef?.current ??
      root?.querySelector<HTMLElement>("[data-autofocus]") ??
      focusableWithin(root)[0] ??
      root;
    initial?.focus();
    return () => {
      document.removeEventListener("focusin", trackOwnership);
      if (lockScroll) document.body.style.overflow = previousOverflow;
      const activeAtClose = document.activeElement;
      if (!ownsFocus || !(isDocumentFocus(activeAtClose) || Boolean(root?.contains(activeAtClose))))
        return;
      if (opener?.isConnected) {
        opener.focus();
        return;
      }
      // The commit that closed this dialog may also have removed its opener
      // (a rescheduled row). Wait for it, then use the fallback unless a newer
      // dialog or control has taken focus in the meantime.
      queueMicrotask(() => {
        const activeNow = document.activeElement;
        if (!isDocumentFocus(activeNow) && activeNow !== opener) return;
        const target = opener?.isConnected ? opener : latest.current.fallbackFocusRef?.current;
        if (target?.isConnected) target.focus();
      });
    };
  }, [lockScroll, open, ref]);
}

export interface DialogProps extends DialogFocusOptions {
  readonly onClose: () => void;
  readonly closeLocked?: boolean;
  readonly closeOnBackdrop?: boolean;
  readonly labelledBy?: string;
  readonly label?: string;
  readonly describedBy?: string;
  readonly busy?: boolean;
  readonly className?: string;
  readonly backdropClassName?: string;
  readonly children: ReactNode;
}

/**
 * The one modal surface: portal, `role="dialog"`, focus trap, Escape, initial
 * focus, focus restore, and the workspace's open-dialog count.
 */
export const Dialog = forwardRef<HTMLDivElement, DialogProps>(function Dialog(
  {
    open = true,
    onClose,
    closeLocked = false,
    closeOnBackdrop = false,
    labelledBy,
    label,
    describedBy,
    busy,
    className = "",
    backdropClassName = "",
    initialFocusRef,
    fallbackFocusRef,
    lockScroll,
    children,
  },
  forwardedRef,
) {
  const ownRef = useRef<HTMLDivElement | null>(null);
  useDialogPresence(open);
  useDialogFocus(ownRef, { open, initialFocusRef, fallbackFocusRef, lockScroll });
  if (!open) return null;
  return createPortal(
    <div
      className={`dialog-backdrop ${backdropClassName}`.trim()}
      onMouseDown={
        closeOnBackdrop
          ? (event) => {
              if (event.target === event.currentTarget && !closeLocked) onClose();
            }
          : undefined
      }
    >
      <div
        ref={(node) => {
          ownRef.current = node;
          if (typeof forwardedRef === "function") forwardedRef(node);
          else if (forwardedRef) forwardedRef.current = node;
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={label}
        aria-describedby={describedBy}
        aria-busy={busy}
        className={`dialog ${className}`.trim()}
        tabIndex={-1}
        onKeyDown={(event) => dialogKeyDown(event, ownRef.current, { onClose, closeLocked })}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
});
