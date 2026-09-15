import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import type { CalendarEvent, CalendarPreference } from "../../types/domain";
import type { EventDetail } from "../../../../shared/calendarEventContract";
import type { CalendarService } from "./calendarService";
import {
  detailInput,
  inputValues,
  newEventInput,
  type CalendarSlot,
  type EventInput,
} from "./eventInput";
import { serviceErrorMessage } from "../../lib/serviceError";

export function EventEditor({
  service,
  timezone,
  slot,
  event,
  onClose,
  onSaved,
}: {
  service: CalendarService;
  timezone: string;
  slot: CalendarSlot;
  event?: CalendarEvent;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = useRef(false);
  const textEdits = useRef<Partial<Pick<EventInput, "title" | "location">>>({});
  const [createId] = useState(() => crypto.randomUUID().replace(/-/g, ""));
  const [input, setInput] = useState(() => newEventInput(slot, timezone));
  const baseline = useRef(input);
  const [confirmClose, setConfirmClose] = useState(false);
  const keepEditing = useRef<HTMLButtonElement>(null);
  const dirty = JSON.stringify(input) !== JSON.stringify(baseline.current);
  const requestClose = () => {
    if (pending.current) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  };
  useEffect(() => {
    if (confirmClose) keepEditing.current?.focus();
  }, [confirmClose]);
  const [calendars, setCalendars] = useState<CalendarPreference[]>([]);
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [scope, setScope] = useState<"instance" | "series">("instance");
  const [pendingScope, setPendingScope] = useState<"instance" | "series" | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setConfirmDelete(false);
    if (event) setDetail(null);
    void Promise.all([
      service.calendars(controller.signal),
      event
        ? service.eventDetail!(event.calendarId, event.eventId, scope, controller.signal)
        : Promise.resolve(null),
    ])
      .then(([records, loaded]) => {
        if (controller.signal.aborted) return;
        setCalendars(records);
        setDetail(loaded);
        setInput((previous) => {
          const calendarId =
            previous.calendarId ||
            records.find((item) => item.canEdit && item.isVisible)?.calendarId ||
            records.find((item) => item.canEdit)?.calendarId ||
            "";
          baseline.current = loaded ? detailInput(loaded) : { ...baseline.current, calendarId };
          return loaded
            ? { ...baseline.current, ...textEdits.current }
            : { ...previous, calendarId };
        });
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(serviceErrorMessage(reason, "Event could not load."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [service, event, scope, revision]);
  const change = <K extends keyof EventInput>(key: K, value: EventInput[K]) => {
    if (key === "title" || key === "location")
      textEdits.current = { ...textEdits.current, [key]: value };
    setInput((current) => ({ ...current, [key]: value }));
    setConfirmDelete(false);
  };
  const changeScope = (next: "instance" | "series") => {
    const initial = detail && detailInput(detail);
    const fields = [
      "start",
      "end",
      "allDay",
      "repeat",
      "interval",
      "repeatEnd",
      "until",
      "count",
      "calendarId",
    ] as const;
    if (initial && fields.some((key) => input[key] !== initial[key])) setPendingScope(next);
    else setScope(next);
  };
  const writable = calendars.some(
    (item) => item.calendarId === (event?.calendarId ?? input.calendarId) && item.canEdit,
  );
  const instance = !!detail?.recurring && scope === "instance";
  async function submit(remove: boolean) {
    if (pending.current) return;
    setError("");
    try {
      const values = remove ? null : inputValues(input, instance, detail);
      pending.current = true;
      setBusy(true);
      const result = await service.mutateEvent!(
        event && detail
          ? remove
            ? {
                action: "delete",
                calendarId: event.calendarId,
                eventId: event.eventId,
                scope,
                etag: detail.etag,
              }
            : {
                action: "update",
                calendarId: event.calendarId,
                eventId: event.eventId,
                scope,
                etag: detail.etag,
                destinationCalendarId: input.calendarId,
                values: values!,
              }
          : { action: "create", calendarId: input.calendarId, eventId: createId, values: values! },
      );
      onSaved(result.warning ?? (remove ? "Event deleted." : "Event saved."));
    } catch (reason) {
      setError(serviceErrorMessage(reason, "Event could not be saved."));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return createPortal(
    <dialog
      ref={dialog}
      className="event-editor"
      aria-labelledby="event-editor-title"
      onCancel={(e) => {
        e.preventDefault();
        requestClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(false);
        }}
      >
        <header>
          <h2 id="event-editor-title">{event ? "Edit event" : "New event"}</h2>
          <button type="button" onClick={requestClose} disabled={busy}>
            Close
          </button>
        </header>
        {confirmClose && (
          <div className="event-discard-confirm" role="alert">
            <p>Discard your unsaved changes?</p>
            <div>
              <button
                ref={keepEditing}
                type="button"
                onClick={() => {
                  setConfirmClose(false);
                  dialog.current?.querySelector<HTMLInputElement>("input")?.focus();
                }}
              >
                Keep editing
              </button>
              <button type="button" onClick={onClose}>
                Discard changes
              </button>
            </div>
          </div>
        )}
        {loading && <p role="status">Loading event details…</p>}
        {error && (
          <div role="alert">
            <p>{error}</p>
            {!detail && event && (
              <button
                type="button"
                onClick={() => setRevision((value) => value + 1)}
                disabled={busy}
              >
                Retry loading
              </button>
            )}
            <Link to="/settings" onClick={onClose}>
              Calendar settings
            </Link>
          </div>
        )}
        {!loading && (!event || detail) && (
          <>
            {detail?.recurring && (
              <label>
                Apply changes to
                <select
                  value={scope}
                  disabled={busy}
                  onChange={(e) => changeScope(e.target.value as "instance" | "series")}
                >
                  <option value="instance">This event</option>
                  <option value="series">Entire series</option>
                </select>
              </label>
            )}
            {pendingScope && (
              <div className="event-delete-confirm" role="status">
                <p>
                  Switching scope reloads dates, repeat settings, and calendar choice. Your title
                  and location edits will be kept.
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setScope(pendingScope);
                    setPendingScope(null);
                  }}
                >
                  Switch scope
                </button>
                <button type="button" onClick={() => setPendingScope(null)}>
                  Keep editing
                </button>
              </div>
            )}
            {scope === "series" && detail?.recurring && (
              <p className="event-note">
                Changes affect the entire series, including past events. Dates below belong to the
                first event.
              </p>
            )}
            <fieldset disabled={busy || !writable}>
              <label>
                Title
                <input
                  autoFocus
                  maxLength={1024}
                  value={input.title}
                  placeholder="Add title"
                  onChange={(e) => change("title", e.target.value)}
                />
              </label>
              <label className="event-checkbox">
                <input
                  type="checkbox"
                  checked={input.allDay}
                  onChange={(e) => change("allDay", e.target.checked)}
                />
                All day
              </label>
              <div className="event-time-fields">
                {(["start", "end"] as const).map((key) => (
                  <label key={key}>
                    {key === "start" ? "Starts" : "Ends"}
                    <input
                      required
                      type={input.allDay ? "date" : "datetime-local"}
                      value={input.allDay ? input[key].slice(0, 10) : input[key]}
                      onChange={(e) =>
                        change(
                          key,
                          input.allDay
                            ? `${e.target.value}${input[key].slice(10)}`
                            : e.target.value,
                        )
                      }
                    />
                  </label>
                ))}
              </div>
              <p className="event-note">
                {input.allDay
                  ? "All-day end date is inclusive."
                  : `Times in ${input.timeZone.replace(/_/g, " ")}.`}
              </p>
              <label>
                Repeats
                <select
                  value={instance ? "keep" : input.repeat}
                  disabled={instance}
                  onChange={(e) => change("repeat", e.target.value)}
                >
                  {(detail?.recurring || input.repeat === "keep") && (
                    <option value="keep">Keep existing repeat schedule</option>
                  )}
                  <option value="none">Does not repeat</option>
                  <option value="DAILY">Daily</option>
                  <option value="WEEKLY">Weekly</option>
                  <option value="weekdays">Every weekday</option>
                  <option value="MONTHLY">Monthly on this date</option>
                  <option value="YEARLY">Yearly</option>
                </select>
              </label>
              {instance && (
                <p className="event-note">Choose Entire series to change the repeat schedule.</p>
              )}
              {!instance && !["none", "keep"].includes(input.repeat) && (
                <div className="event-repeat-fields">
                  <label>
                    Repeat interval
                    <input
                      type="number"
                      required
                      min={1}
                      max={99}
                      value={input.interval}
                      onChange={(e) => change("interval", Number(e.target.value))}
                    />
                  </label>
                  <label>
                    Repeat ends
                    <select
                      value={input.repeatEnd}
                      onChange={(e) => change("repeatEnd", e.target.value)}
                    >
                      <option value="never">Never</option>
                      <option value="until">On date</option>
                      <option value="count">After occurrences</option>
                    </select>
                  </label>
                  {input.repeatEnd === "until" && (
                    <label>
                      Last repeat date
                      <input
                        type="date"
                        required
                        value={input.until}
                        onChange={(e) => change("until", e.target.value)}
                      />
                    </label>
                  )}
                  {input.repeatEnd === "count" && (
                    <label>
                      Occurrences
                      <input
                        type="number"
                        required
                        min={1}
                        max={9999}
                        value={input.count}
                        onChange={(e) => change("count", Number(e.target.value))}
                      />
                    </label>
                  )}
                </div>
              )}
              <label>
                Location
                <input
                  maxLength={4096}
                  value={input.location}
                  placeholder="Add location"
                  onChange={(e) => change("location", e.target.value)}
                />
              </label>
            </fieldset>
            <label>
              Calendar
              <select
                required
                disabled={busy || (!!event && (!detail?.canMove || !writable))}
                value={input.calendarId}
                onChange={(e) => change("calendarId", e.target.value)}
              >
                {!input.calendarId && <option value="">Choose a calendar</option>}
                {calendars
                  .filter((item) => item.canEdit || item.calendarId === input.calendarId)
                  .map((item) => (
                    <option key={item.calendarId} value={item.calendarId}>
                      {item.displayName}
                      {item.canEdit ? "" : " (read-only)"}
                    </option>
                  ))}
              </select>
            </label>
            {!!event && !detail?.canMove && (
              <p className="event-note">
                Calendar moves are available for events you organize. For a repeating event, choose
                Entire series.
              </p>
            )}
            {!writable && (
              <p role="status">
                {calendars.some((item) => item.canEdit)
                  ? "This calendar is read-only. Choose a writable calendar for a new event."
                  : "No writable calendars are available."}
              </p>
            )}
            {event && (
              <p className="event-note">
                Existing guests receive Google Calendar updates when you save or delete.
              </p>
            )}
            {confirmDelete ? (
              <div className="event-delete-confirm">
                <p>
                  Delete{" "}
                  {scope === "series" && detail?.recurring ? "the entire series" : "this event"}{" "}
                  from Google Calendar?
                </p>
                <button type="button" disabled={busy} onClick={() => void submit(true)}>
                  {busy ? "Deleting…" : "Confirm delete"}
                </button>
                <button type="button" disabled={busy} onClick={() => setConfirmDelete(false)}>
                  Keep event
                </button>
              </div>
            ) : (
              <footer>
                {event && (
                  <button
                    type="button"
                    className="event-delete"
                    disabled={busy || !writable}
                    onClick={() => setConfirmDelete(true)}
                  >
                    Delete event
                  </button>
                )}
                <button
                  type="submit"
                  className="event-save"
                  disabled={busy || !writable || !input.calendarId}
                >
                  {busy ? "Saving…" : "Save event"}
                </button>
              </footer>
            )}
          </>
        )}
      </form>
    </dialog>,
    document.body,
  );
}
