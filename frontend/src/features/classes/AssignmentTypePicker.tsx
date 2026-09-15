import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { dialogKeyDown } from "../../components/dialog/Dialog";
import "./assignmentTypePicker.css";

const types = ["Homework", "Quiz", "Reading", "Exam", "Other", ""];

/** Inline type choice for the assignment table, including unsaved rows. */
export function AssignmentTypePicker({
  value,
  label,
  disabled,
  busy,
  buttonRef,
  onChange,
  onKeyDown,
}: {
  value: string;
  label: string;
  disabled?: boolean;
  busy?: boolean;
  buttonRef?(node: HTMLButtonElement | null): void;
  onChange(value: string): void;
  onKeyDown?(event: KeyboardEvent<HTMLButtonElement>): void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement | null>(null);
  const menuId = useId();
  function close(restore = true) {
    // Restore focus inside the draft row before its portalled menu disappears.
    if (restore) anchor.current?.focus();
    setOpen(false);
  }
  return (
    <>
      <button
        type="button"
        className="assignment-cell assignment-type-cell"
        aria-label={label}
        ref={(node) => {
          anchor.current = node;
          buttonRef?.(node);
        }}
        disabled={disabled}
        aria-disabled={busy || disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => {
          if (!busy) setOpen((previous) => !previous);
        }}
        onKeyDown={(event) => {
          if (busy) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          } else onKeyDown?.(event);
        }}
      >
        {value ? <span className="assignment-type-tag">{value}</span> : "—"}
      </button>
      {open &&
        createPortal(
          <TypeMenu
            id={menuId}
            value={value}
            anchor={anchor.current!}
            onClose={close}
            onChange={(type) => {
              onChange(type);
              close();
            }}
          />,
          document.body,
        )}
    </>
  );
}

function TypeMenu({
  id,
  value,
  anchor,
  onChange,
  onClose,
}: {
  id: string;
  value: string;
  anchor: HTMLButtonElement;
  onChange(value: string): void;
  onClose(restore?: boolean): void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(Math.max(0, types.indexOf(value)));
  const latestClose = useRef(onClose);
  latestClose.current = onClose;
  const search = useRef({ text: "", time: 0 });
  useLayoutEffect(() => {
    const element = panel.current!;
    function place() {
      const rect = anchor.getBoundingClientRect();
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - element.offsetWidth - 12));
      const below = rect.bottom + 6;
      const top =
        below + element.offsetHeight <= window.innerHeight - 12
          ? below
          : Math.max(12, rect.top - element.offsetHeight - 6);
      element.style.left = `${left}px`;
      element.style.top = `${top}px`;
    }
    function outside(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !element.contains(event.target) &&
        !anchor.contains(event.target)
      )
        latestClose.current();
    }
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    document.addEventListener("pointerdown", outside, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      document.removeEventListener("pointerdown", outside, true);
    };
  }, [anchor]);
  useLayoutEffect(() => {
    options.current[active]?.focus();
  }, [active]);

  return (
    <div
      ref={panel}
      id={id}
      className="assignment-type-menu"
      role="listbox"
      aria-label="Assignment type"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== anchor)
          onClose(false);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        dialogKeyDown(event, panel.current, { onClose, trapTab: false });
        // Returning focus to the trigger lets native Tab advance through the table.
        if (event.key === "Tab") onClose();
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setActive(
            (previous) =>
              (previous + (event.key === "ArrowDown" ? 1 : -1) + types.length) % types.length,
          );
        }
        if (event.key === "Home" || event.key === "End") {
          event.preventDefault();
          setActive(event.key === "Home" ? 0 : types.length - 1);
        }
        if (
          event.key.length === 1 &&
          /\S/.test(event.key) &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey
        ) {
          event.preventDefault();
          const now = Date.now();
          const text =
            (now - search.current.time < 700 ? search.current.text : "") + event.key.toLowerCase();
          search.current = { text, time: now };
          const index = types.findIndex((type) => (type || "None").toLowerCase().startsWith(text));
          if (index >= 0) setActive(index);
        }
      }}
    >
      {types.map((type, index) => (
        <button
          type="button"
          role="option"
          aria-selected={type === value}
          className={type ? undefined : "assignment-type-none"}
          key={type}
          ref={(node) => {
            options.current[index] = node;
          }}
          tabIndex={active === index ? 0 : -1}
          onFocus={() => setActive(index)}
          onClick={() => onChange(type)}
        >
          {type || "None"}
        </button>
      ))}
    </div>
  );
}
