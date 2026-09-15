import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { WorkspaceDialog } from "../../apps/WorkspaceDialog";
import {
  EMPTY_APPEARANCE,
  prepareCover,
  type HomeAppearance,
  type HomeAppearanceService,
} from "./homeAppearance";
import { COLLAPSED_COVER_HEIGHT, COMPACT_COVER_HEIGHT, coverImageLayout } from "./coverLayout";
import { serviceErrorMessage } from "../../lib/serviceError";
import { peekRead } from "../../apps/navigationCache";
import { registerUserStateResetter } from "../../auth/userState";

// Decoded cover dimensions, keyed by image src, so a revisit to an
// already-seen cover has geometry ready on the very first layout pass
// instead of waiting ~50ms for the <img> to decode again. Data-URI keys can
// be up to ~350KB each, so this is capped with simple FIFO eviction and
// cleared entirely at the account boundary.
const DECODED_COVER_SIZE_LIMIT = 4;
// Exported only for the eviction test below.
export const decodedCoverSize = new Map<string, { width: number; height: number }>();

function rememberCoverSize(src: string, size: { width: number; height: number }): void {
  decodedCoverSize.delete(src);
  decodedCoverSize.set(src, size);
  while (decodedCoverSize.size > DECODED_COVER_SIZE_LIMIT) {
    const oldest = decodedCoverSize.keys().next().value;
    if (oldest === undefined) break;
    decodedCoverSize.delete(oldest);
  }
}

registerUserStateResetter(() => decodedCoverSize.clear());

interface HomeHeaderProps {
  service?: HomeAppearanceService;
  userId: string;
  // The scroll container element itself (not a ref object): passed as state
  // set from a callback ref by the parent, so it's already populated on this
  // component's very first render/layout-effect pass instead of a render
  // behind, avoiding an extra visible commit before the cover geometry applies.
  pageElement?: HTMLDivElement | null;
}
export function HomeHeader(props: HomeHeaderProps) {
  return <HomeHeaderAccount key={props.userId} {...props} />;
}
function HomeHeaderAccount({ service, userId, pageElement }: HomeHeaderProps) {
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
  useLayoutEffect(() => {
    const page = pageElement;
    if (!page || !coverReady) return;
    page.classList.add("home-page--cover");
    let fullHeight = COMPACT_COVER_HEIGHT;
    let initialized = false;
    const measure = () => {
      const css = getComputedStyle(page);
      const width = page.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
      const available =
        page.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom);
      if (width <= 0 || available <= 0) return;
      const fraction = initialized
        ? Math.min(1, page.scrollTop / (fullHeight - COLLAPSED_COVER_HEIGHT))
        : 0;
      fullHeight = Math.max(
        COMPACT_COVER_HEIGHT + 1,
        Math.min((width * imageSize.height) / imageSize.width, available * 0.75),
      );
      const top = initialized
        ? fraction * (fullHeight - COLLAPSED_COVER_HEIGHT)
        : fullHeight - COMPACT_COVER_HEIGHT;
      page.style.setProperty("--home-cover-height", `${fullHeight}px`);
      page.style.setProperty("--home-workspace-height", `${available - COLLAPSED_COVER_HEIGHT}px`);
      page.scrollTop = top;
      setLayout({ width, fullHeight, height: fullHeight - top });
      initialized = true;
    };
    const scroll = () =>
      setLayout((previous) => ({
        ...previous,
        height: Math.max(COLLAPSED_COVER_HEIGHT, fullHeight - page.scrollTop),
      }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(page);
    page.addEventListener("scroll", scroll, { passive: true });
    return () => {
      observer.disconnect();
      page.removeEventListener("scroll", scroll);
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
  const collapsed = collapsible && layout.height <= COLLAPSED_COVER_HEIGHT + 1;
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
      top: layout.height >= layout.fullHeight - 1 ? layout.fullHeight - COLLAPSED_COVER_HEIGHT : 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  return (
    <header
      className={`home-header${value.coverImage ? " home-header--cover" : ""}${collapsed ? " home-header--collapsed" : ""}`}
    >
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
          />
        )}
        <div className="home-header__line">
          {value.title ? <h1>{value.title}</h1> : <h1 className="cloud-shell__sr-only">Home</h1>}
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
