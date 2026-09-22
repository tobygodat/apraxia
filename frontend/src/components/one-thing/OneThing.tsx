import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useWorkspace } from "../../apps/workspaceStore";
import type { TodoService } from "../../features/todos/todoService";
import { localToday } from "../../features/todos/dateDomain";
import "./oneThing.css";

/**
 * "Just one thing", the workspace's hidden room.
 *
 * apraxia is named for the gap between meaning to do something and starting
 * it. Nothing in the interface points here: the Konami code, or five quick
 * taps on the mark in the sidebar, dims the workspace and puts the day's first
 * task alone on the screen with a two-minute ring, the old trick of starting
 * anything for just two minutes. When the ring closes, or you say you have
 * started, the room celebrates and lets you go.
 *
 * It only reads: the task stays exactly as it was, and finishing it is still
 * done where it lives.
 */

const KONAMI = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
];

/** The mark dispatches this after five quick taps. */
export const ONE_THING_EVENT = "apraxia:one-thing";

const TWO_MINUTES_MS = 120_000;
const RING_RADIUS = 54;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Counts quick taps on an element; the fifth within two seconds opens the room. */
export function useOneThingTaps(): () => void {
  const taps = useRef<number[]>([]);
  return useCallback(() => {
    const now = Date.now();
    taps.current = [...taps.current.filter((time) => now - time < 2000), now];
    if (taps.current.length >= 5) {
      taps.current = [];
      window.dispatchEvent(new CustomEvent(ONE_THING_EVENT));
    }
  }, []);
}

type Stage = "loading" | "ready" | "running" | "started";

export function OneThing({ service }: { readonly service: TodoService }) {
  const { profile } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("loading");
  const [task, setTask] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(TWO_MINUTES_MS);
  const returnFocus = useRef<HTMLElement | null>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const titleId = useId();

  const show = useCallback(() => {
    if (open) return;
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setStage("loading");
    setTask(null);
    setRemaining(TWO_MINUTES_MS);
    setOpen(true);
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    returnFocus.current?.focus();
  }, []);

  // The two ways in: a key sequence, or the mark's taps.
  useEffect(() => {
    let position = 0;
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      position = key === KONAMI[position] ? position + 1 : key === KONAMI[0] ? 1 : 0;
      if (position === KONAMI.length) {
        position = 0;
        show();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(ONE_THING_EVENT, show);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(ONE_THING_EVENT, show);
    };
  }, [show]);

  // Read today's first task when the room opens.
  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    const today = localToday(profile?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
    service
      .loadToday(today, { signal: controller.signal })
      .then((todos) => {
        if (controller.signal.aborted) return;
        setTask(todos[0]?.text ?? null);
        setStage("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setStage("ready");
      });
    return () => controller.abort();
  }, [open, profile, service]);

  useEffect(() => {
    if (open && stage !== "loading") primaryRef.current?.focus();
  }, [open, stage]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
      // Two buttons at most: keep Tab inside the card.
      if (event.key === "Tab") {
        const buttons = [...document.querySelectorAll<HTMLButtonElement>(".one-thing button")];
        if (!buttons.length) return;
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  // The two minutes.
  useEffect(() => {
    if (stage !== "running") return undefined;
    const started = Date.now();
    const timer = window.setInterval(() => {
      const left = Math.max(0, TWO_MINUTES_MS - (Date.now() - started));
      setRemaining(left);
      if (left === 0) setStage("started");
    }, 250);
    return () => window.clearInterval(timer);
  }, [stage]);

  // The celebration, and then the room lets you go.
  useEffect(() => {
    if (stage !== "started") return undefined;
    const canvas = canvasRef.current;
    const stop = canvas && !prefersReducedMotion() ? burst(canvas) : () => {};
    const leave = window.setTimeout(close, 3600);
    return () => {
      stop();
      window.clearTimeout(leave);
    };
  }, [stage, close]);

  if (!open) return null;

  const elapsed = 1 - remaining / TWO_MINUTES_MS;
  const minutes = Math.floor(Math.ceil(remaining / 1000) / 60);
  const seconds = String(Math.ceil(remaining / 1000) % 60).padStart(2, "0");

  return createPortal(
    <div className="one-thing" data-stage={stage}>
      <canvas ref={canvasRef} className="one-thing__confetti" aria-hidden="true" />
      <div className="one-thing__scrim" onClick={close} aria-hidden="true" />
      <section
        className="one-thing__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 className="one-thing__task" id={titleId}>
          {stage === "loading"
            ? "Finding it…"
            : stage === "started"
              ? "You started."
              : (task ?? "Nothing is due today.")}
        </h2>
        <p className="one-thing__hint">
          {stage === "started"
            ? "That was the hard part. Carry on for as long as it goes."
            : task
              ? "Just this, for two minutes. Starting is the whole trick."
              : "Pick anything small and give it two minutes."}
        </p>

        <div className="one-thing__ring" aria-hidden={stage !== "running"}>
          <svg viewBox="0 0 128 128">
            <circle className="one-thing__track" cx="64" cy="64" r={RING_RADIUS} />
            <circle
              className="one-thing__progress"
              cx="64"
              cy="64"
              r={RING_RADIUS}
              strokeDasharray={RING_LENGTH}
              strokeDashoffset={RING_LENGTH * (1 - (stage === "started" ? 1 : elapsed))}
            />
          </svg>
          <span className="one-thing__time" role={stage === "running" ? "timer" : undefined}>
            {stage === "started" ? (
              <svg className="one-thing__tick" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12.5 10 17.5 19.5 7" />
              </svg>
            ) : (
              `${minutes}:${seconds}`
            )}
          </span>
        </div>

        <div className="one-thing__actions">
          {stage === "running" ? (
            <button
              ref={primaryRef}
              type="button"
              className="one-thing__primary"
              onClick={() => setStage("started")}
            >
              I’ve started
            </button>
          ) : stage === "started" ? null : (
            <button
              ref={primaryRef}
              type="button"
              className="one-thing__primary"
              disabled={stage === "loading"}
              onClick={() => setStage("running")}
            >
              Start two minutes
            </button>
          )}
          <button type="button" className="one-thing__quiet" onClick={close}>
            {stage === "started" ? "Close" : "Not now"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}

const CONFETTI_COLOURS = [
  "#2783de",
  "#eb5757",
  "#f5b342",
  "#4fb07a",
  "#9065b0",
  "#d9730d",
  "#c14c8a",
];

/** A short burst of paper confetti from the centre of the screen; returns a stop. */
function burst(canvas: HTMLCanvasElement): () => void {
  const context = canvas.getContext("2d");
  if (!context) return () => {};
  const ratio = window.devicePixelRatio || 1;
  const width = window.innerWidth;
  const height = window.innerHeight;
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  context.scale(ratio, ratio);

  const pieces = Array.from({ length: 140 }, () => {
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
    const speed = 7 + Math.random() * 9;
    return {
      x: width / 2,
      y: height / 2 - 40,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 5 + Math.random() * 6,
      spin: (Math.random() - 0.5) * 0.4,
      turn: Math.random() * Math.PI,
      colour: CONFETTI_COLOURS[Math.floor(Math.random() * CONFETTI_COLOURS.length)] ?? "#2783de",
    };
  });

  let frame = 0;
  const started = performance.now();
  const step = (now: number) => {
    const age = now - started;
    context.clearRect(0, 0, width, height);
    for (const piece of pieces) {
      piece.vx *= 0.985;
      piece.vy = piece.vy * 0.985 + 0.32;
      piece.x += piece.vx;
      piece.y += piece.vy;
      piece.turn += piece.spin;
      context.save();
      context.globalAlpha = Math.max(0, 1 - age / 2600);
      context.translate(piece.x, piece.y);
      context.rotate(piece.turn);
      context.fillStyle = piece.colour;
      context.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
      context.restore();
    }
    if (age < 2600) frame = window.requestAnimationFrame(step);
    else context.clearRect(0, 0, width, height);
  };
  frame = window.requestAnimationFrame(step);
  return () => window.cancelAnimationFrame(frame);
}
