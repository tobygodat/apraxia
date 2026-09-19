import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Temporal } from "@js-temporal/polyfill";
import { WorkspaceDialog } from "../../apps/WorkspaceDialog";
import {
  EMPTY_APPEARANCE,
  prepareCover,
  type HomeAppearance,
  type HomeAppearanceService,
} from "./homeAppearance";
import { COMPACT_COVER_HEIGHT, coverImageLayout } from "./coverLayout";
import { decodedCoverSize, rememberCoverSize } from "./coverImageCache";
import { serviceErrorMessage } from "../../lib/serviceError";
import { peekRead } from "../../apps/navigationCache";
import { useColdLoad } from "../../apps/coldLoad";

/** Matches the app shell's sidebar column transition (--cloud-shell-duration). */
const SETTLE_DURATION_MS = 260;

/** "Friday, September 18" from a plain calendar date, with no timezone maths. */
function longDate(date: string) {
  return Temporal.PlainDate.from(date).toLocaleString("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

interface HomeHeaderProps {
  service?: HomeAppearanceService;
  userId: string;
  /** Today in the profile's timezone. Paper prints it under the page name. */
  date?: string;
  /** Today's counts, printed after the date. Absent until the panel reports. */
  summary?: { readonly dueToday: number; readonly overdue: number } | null;
  // The scroll container element itself (not a ref object): passed as state
  // set from a callback ref by the parent, so it's already populated on this
  // component's very first render/layout-effect pass instead of a render
  // behind, avoiding an extra visible commit before the cover geometry applies.
  pageElement?: HTMLDivElement | null;
}
export function HomeHeader(props: HomeHeaderProps) {
  return <HomeHeaderAccount key={props.userId} {...props} />;
}
function HomeHeaderAccount({ service, userId, pageElement, date, summary }: HomeHeaderProps) {
  // Render the cover on first paint when an earlier navigation already warmed
  // this read, instead of flashing a collapsed header while it refetches.
  // The trailing signal is only there to satisfy the type signature; peekRead
  // strips AbortSignal args before matching against the cached key. Read once
  // via a useState initializer so this (and its AbortController) run only on
  // mount, not on every render.
  const [seeded] = useState(() =>
    service ? peekRead(service, "load", userId, new AbortController().signal) : undefined,
  );
  const [value, setValue] = useState<HomeAppearance>(() => seeded ?? EMPTY_APPEARANCE);
  const [ready, setReady] = useState(() => seeded !== undefined);
  // The load effect below always runs on mount; skip its "loading" reset only
  // for that very first run when a warm cache already seeded ready content.
  const firstRun = useRef(seeded !== undefined);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState(false);
  const [imageSize, setImageSize] = useState(() => {
    const src = seeded?.coverImage;
    const cached = src ? decodedCoverSize.get(src) : undefined;
    return cached
      ? { src: src!, width: cached.width, height: cached.height }
      : { src: "", width: 1, height: 1 };
  });
  const [layout, setLayout] = useState({
    width: 1,
    fullHeight: COMPACT_COVER_HEIGHT,
    height: COMPACT_COVER_HEIGHT,
  });
  const coverReady = !!value.coverImage && imageSize.src === value.coverImage;
  const [imageErrored, setImageErrored] = useState(false);
  // Idempotent "reset on cover change" instead of mutating a ref during
  // render: comparing against state (not a ref) means this stays correct
  // under StrictMode's double-invoked render.
  const [erroredFor, setErroredFor] = useState<string | null>(null);
  const coverKey = value.coverImage ?? null;
  if (erroredFor !== coverKey) {
    setErroredFor(coverKey);
    setImageErrored(false);
  }
  useColdLoad((!ready && !error) || (!!value.coverImage && !coverReady && !imageErrored));
  useLayoutEffect(() => {
    const page = pageElement;
    if (!page || !coverReady) return;
    page.classList.add("home-page--cover");
    let fullHeight = COMPACT_COVER_HEIGHT;
    let initialized = false;
    let held = false;
    let settleFrame = 0;
    let settleTarget = 0;
    // While the app shell is sliding its sidebar column, the content width
    // changes every frame. Re-measuring per frame would resize the cover and
    // rewrite the scroll position a frame behind the sidebar, so hold the
    // layout and ease into the new size once the column transition ends.
    const shellIsAnimating = () =>
      (document.getAnimations?.() ?? []).some(
        (animation) =>
          animation instanceof CSSTransition &&
          animation.transitionProperty === "grid-template-columns",
      );
    const compute = () => {
      const css = getComputedStyle(page);
      const width = page.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
      const available =
        page.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom);
      if (width <= 0 || available <= 0) return null;
      const fraction = initialized
        ? Math.min(1, page.scrollTop / (fullHeight - COMPACT_COVER_HEIGHT))
        : 0;
      const nextFullHeight = Math.max(
        COMPACT_COVER_HEIGHT + 1,
        Math.min((width * imageSize.height) / imageSize.width, available * 0.75),
      );
      const top = initialized
        ? fraction * (nextFullHeight - COMPACT_COVER_HEIGHT)
        : nextFullHeight - COMPACT_COVER_HEIGHT;
      return { width, available, fullHeight: nextFullHeight, top };
    };
    // The cover rests at COMPACT_COVER_HEIGHT and the page rests at its maximum
    // scroll, so the workspace reservation, the collapse floor, and the initial
    // offset all measure against the same height. Reserving less (the bare title
    // bar) left the workspace hanging below the fold at rest, which truncated the
    // calendar and forced a whole-page scroll to reach the evening hours.
    const apply = (next: { width: number; available: number; fullHeight: number; top: number }) => {
      fullHeight = next.fullHeight;
      page.style.setProperty("--home-cover-height", `${next.fullHeight}px`);
      page.style.setProperty(
        "--home-workspace-height",
        `${next.available - COMPACT_COVER_HEIGHT}px`,
      );
      page.scrollTop = next.top;
      setLayout({
        width: next.width,
        fullHeight: next.fullHeight,
        height: next.fullHeight - next.top,
      });
      initialized = true;
    };
    const measure = () => {
      if (shellIsAnimating()) {
        held = true;
        return;
      }
      const next = compute();
      if (!next) return;
      // The resize observer and the transitionend listener both report the
      // settled size; whichever arrives second must not restart the ease.
      if (settleFrame && Math.abs(next.fullHeight - settleTarget) < 0.5) return;
      cancelAnimationFrame(settleFrame);
      settleFrame = 0;
      const reduceMotion =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!held || reduceMotion || !initialized) {
        held = false;
        apply(next);
        return;
      }
      // Settle: the width is already final, so ease only the height and the
      // scroll offset that depends on it, matching the shell's own duration.
      held = false;
      settleTarget = next.fullHeight;
      const from = { fullHeight, top: page.scrollTop };
      const start = performance.now();
      const step = (now: number) => {
        const progress = Math.min(1, Math.max(0, (now - start) / SETTLE_DURATION_MS));
        const eased = 1 - (1 - progress) ** 3;
        apply({
          width: next.width,
          available: next.available,
          fullHeight: from.fullHeight + (next.fullHeight - from.fullHeight) * eased,
          top: from.top + (next.top - from.top) * eased,
        });
        settleFrame = progress < 1 ? requestAnimationFrame(step) : 0;
      };
      settleFrame = requestAnimationFrame(step);
    };
    const scroll = () =>
      setLayout((previous) => ({
        ...previous,
        height: Math.max(COMPACT_COVER_HEIGHT, fullHeight - page.scrollTop),
      }));
    const settle = (event: TransitionEvent) => {
      if (event.propertyName === "grid-template-columns" && held) measure();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(page);
    page.addEventListener("scroll", scroll, { passive: true });
    document.addEventListener("transitionend", settle);
    return () => {
      cancelAnimationFrame(settleFrame);
      observer.disconnect();
      page.removeEventListener("scroll", scroll);
      document.removeEventListener("transitionend", settle);
      page.classList.remove("home-page--cover");
      page.style.removeProperty("--home-cover-height");
      page.style.removeProperty("--home-workspace-height");
      page.scrollTop = 0;
    };
  }, [pageElement, coverReady, imageSize]);
  useEffect(() => {
    if (!service) return;
    const controller = new AbortController();
    const skipReset = firstRun.current;
    firstRun.current = false;
    if (!skipReset) {
      setReady(false);
      setError("");
    }
    void service
      .load(userId, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setValue(result);
          setReady(true);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Couldn’t load page appearance.");
      });
    return () => controller.abort();
  }, [service, userId, revision]);
  const collapsible = coverReady && !!pageElement;
  const imageStyle = coverReady
    ? coverImageLayout(
        layout.width,
        layout.height,
        layout.fullHeight,
        imageSize.width,
        imageSize.height,
        value.coverPositionX,
        value.coverPositionY,
      )
    : undefined;
  const scrollCover = () =>
    pageElement?.scrollTo({
      top: layout.height >= layout.fullHeight - 1 ? layout.fullHeight - COMPACT_COVER_HEIGHT : 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  return (
    <header className={`home-header${value.coverImage ? " home-header--cover" : ""}`}>
      <div
        className="home-header__frame"
        style={collapsible ? { height: layout.height } : undefined}
      >
        {value.coverImage && (
          <img
            className="home-header__cover"
            src={value.coverImage}
            alt=""
            style={
              collapsible
                ? imageStyle
                : {
                    objectPosition: `${value.coverPositionX ?? 50}% ${value.coverPositionY ?? 50}%`,
                  }
            }
            onLoad={(event) => {
              const width = event.currentTarget.naturalWidth;
              const height = event.currentTarget.naturalHeight;
              rememberCoverSize(value.coverImage!, { width, height });
              setImageSize({ src: value.coverImage!, width, height });
            }}
            onError={() => setImageErrored(true)}
          />
        )}
        <div className="home-header__line">
          {value.title ? <h1>{value.title}</h1> : <h1 className="cloud-shell__sr-only">Home</h1>}
          {date && (
            <p className="home-header__date">
              <span>{longDate(date)}</span>
              {summary && summary.dueToday > 0 ? <span>{summary.dueToday} due today</span> : null}
              {summary && summary.overdue > 0 ? (
                <span className="home-header__late">{summary.overdue} overdue</span>
              ) : null}
            </p>
          )}
          <div className="home-header__actions">
            {collapsible && (
              <button className="home-header__customize" onClick={scrollCover}>
                {layout.height >= layout.fullHeight - 1 ? "Collapse cover" : "Expand cover"}
              </button>
            )}
            {service && (
              <button
                className="home-header__customize"
                disabled={!ready}
                onClick={() => setOpen(true)}
              >
                Customize page
              </button>
            )}
          </div>
        </div>
      </div>
      {error && (
        <p className="home-header__error" role="status">
          {error} <button onClick={() => setRevision((v) => v + 1)}>Try again</button>
        </p>
      )}
      {open && service && (
        <AppearanceEditor
          value={value}
          service={service}
          userId={userId}
          onClose={() => setOpen(false)}
          onSaved={(result) => {
            setValue(result);
            setOpen(false);
          }}
        />
      )}
    </header>
  );
}
function AppearanceEditor({
  value,
  service,
  userId,
  onClose,
  onSaved,
}: {
  value: HomeAppearance;
  service: HomeAppearanceService;
  userId: string;
  onClose(): void;
  onSaved(value: HomeAppearance): void;
}) {
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const work = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      work.current?.abort();
    },
    [],
  );
  const close = () => {
    if (!work.current) onClose();
  };
  async function choose(file?: File) {
    if (!file || work.current) return;
    const attempt = new AbortController();
    work.current = attempt;
    setBusy(true);
    setError("");
    try {
      const coverImage = await prepareCover(file);
      if (!attempt.signal.aborted)
        setDraft((previous) => ({
          ...previous,
          coverImage,
          coverPositionX: 50,
          coverPositionY: 50,
        }));
    } catch (cause) {
      if (!attempt.signal.aborted)
        setError(serviceErrorMessage(cause, "Couldn’t read this image."));
    } finally {
      if (!attempt.signal.aborted) {
        work.current = null;
        setBusy(false);
      }
    }
  }
  async function save() {
    if (work.current) return;
    const attempt = new AbortController();
    work.current = attempt;
    setBusy(true);
    setError("");
    try {
      const saved = await service.save(userId, draft, attempt.signal);
      if (!attempt.signal.aborted) onSaved(saved);
    } catch (cause) {
      if (!attempt.signal.aborted)
        setError(serviceErrorMessage(cause, "Couldn’t save. Try again."));
    } finally {
      if (!attempt.signal.aborted) {
        work.current = null;
        setBusy(false);
      }
    }
  }
  return (
    <WorkspaceDialog title="Customize page" onClose={close}>
      <form
        className="home-appearance-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={busy}>
          <label>
            Page name
            <input
              autoComplete="off"
              maxLength={100}
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              placeholder="Give your workspace a name"
            />
          </label>
          <label>
            Cover image
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                void choose(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
          <p>JPG, PNG, or WebP, up to 10 MB. Saved to your account.</p>
          {draft.coverImage && (
            <>
              <img
                className="home-appearance-preview"
                src={draft.coverImage}
                alt="Cover preview"
                style={{
                  objectPosition: `${draft.coverPositionX ?? 50}% ${draft.coverPositionY ?? 50}%`,
                }}
              />
              <div className="home-appearance-position">
                <label>
                  Horizontal position
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={draft.coverPositionX ?? 50}
                    onChange={(event) =>
                      setDraft({ ...draft, coverPositionX: Number(event.target.value) })
                    }
                  />
                </label>
                <label>
                  Vertical position
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={draft.coverPositionY ?? 50}
                    onChange={(event) =>
                      setDraft({ ...draft, coverPositionY: Number(event.target.value) })
                    }
                  />
                </label>
              </div>
              <p>Position the cropped cover. Scroll up on the cover to reveal the whole image.</p>
              <button type="button" onClick={() => setDraft({ ...draft, coverImage: null })}>
                Remove cover
              </button>
            </>
          )}
        </fieldset>
        {error && <p role="alert">{error}</p>}
        <footer>
          <button type="button" disabled={busy} onClick={close}>
            Cancel
          </button>
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </footer>
      </form>
    </WorkspaceDialog>
  );
}
