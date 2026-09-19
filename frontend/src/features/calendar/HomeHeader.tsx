import { useEffect, useRef, useState } from "react";
import { Temporal } from "@js-temporal/polyfill";
import { WorkspaceDialog } from "../../apps/WorkspaceDialog";
import {
  EMPTY_APPEARANCE,
  type HomeAppearance,
  type HomeAppearanceService,
} from "./homeAppearance";
import { serviceErrorMessage } from "../../lib/serviceError";
import { peekRead } from "../../apps/navigationCache";
import { useColdLoad } from "../../apps/coldLoad";

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
}
export function HomeHeader(props: HomeHeaderProps) {
  return <HomeHeaderAccount key={props.userId} {...props} />;
}
function HomeHeaderAccount({ service, userId, date, summary }: HomeHeaderProps) {
  // Render the name on first paint when an earlier navigation already warmed
  // this read, instead of flashing an empty header while it refetches. The
  // trailing signal is only there to satisfy the type signature; peekRead
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
  useColdLoad(!ready && !error);
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
  return (
    <header className="home-header">
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
        {service && (
          <div className="home-header__actions">
            <button
              className="home-header__customize"
              disabled={!ready}
              onClick={() => setOpen(true)}
            >
              Customize page
            </button>
          </div>
        )}
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
