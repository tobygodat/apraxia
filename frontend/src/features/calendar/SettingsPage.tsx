import { useEffect, useState } from "react";
import type {
  CalendarPreference,
  GoogleCalendarConnectionStatus,
  Profile,
} from "../../types/domain";
import type { CalendarService } from "./calendarService";
import "./calendar.css";
import { serviceErrorMessage } from "../../lib/serviceError";
import { peekRead } from "../../apps/navigationCache";
import { useColdLoad } from "../../apps/coldLoad";

export function SettingsPage({
  calendarService: service,
  profile,
  onSignOut,
}: {
  calendarService: CalendarService;
  profile: Profile;
  onSignOut: () => void | Promise<void>;
}) {
  const cachedStatus = peekRead(service, "status");
  const [status, setStatus] = useState<GoogleCalendarConnectionStatus | null>(cachedStatus ?? null);
  const [calendars, setCalendars] = useState<CalendarPreference[]>(
    (cachedStatus?.connectionState === "connected" ? peekRead(service, "calendars") : undefined) ??
      [],
  );
  const [loading, setLoading] = useState(cachedStatus === undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void service
      .status(controller.signal)
      .then(async (value) => {
        if (controller.signal.aborted) return;
        setStatus(value);
        const records =
          value?.connectionState === "connected" ? await service.calendars(controller.signal) : [];
        if (!controller.signal.aborted) setCalendars(records);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(serviceErrorMessage(reason, "Settings could not load."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [service, revision]);
  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(serviceErrorMessage(reason, "The change could not be saved."));
    } finally {
      setBusy(false);
    }
  };
  const connected = status?.connectionState === "connected";
  useColdLoad(loading && status === null && !error);
  return (
    <section className="calendar-settings" aria-labelledby="calendar-settings-title">
      <h1 id="calendar-settings-title">Settings</h1>

      <section>
        <h2>Google Calendar</h2>
        <p>
          Add, edit, and delete events on calendars you can edit. Choose which calendars appear on
          Home.
        </p>

        {loading && status === null ? (
          <p className="cloud-shell__sr-only" role="status">
            Loading Calendar settings…
          </p>
        ) : (
          <>
            <p>
              {connected
                ? `Connected${status.displayEmail ? ` as ${status.displayEmail}` : ""}`
                : status?.connectionState === "reconnect_required"
                  ? "Reconnect to see your events again."
                  : "Calendar is not connected."}
            </p>
            <div className="calendar-controls">
              {
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      window.location.assign(await service.connect());
                    })
                  }
                >
                  {connected || status?.connectionState === "reconnect_required"
                    ? "Reconnect Calendar"
                    : "Connect Calendar"}
                </button>
              }
              {status && status.connectionState !== "disconnected" && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await service.disconnect();
                      setStatus(null);
                      setCalendars([]);
                    })
                  }
                >
                  Disconnect
                </button>
              )}
            </div>
            {connected && (
              <fieldset disabled={busy}>
                <legend>Visible calendars</legend>
                {calendars.length ? (
                  calendars.map((calendar) => (
                    <label key={calendar.id}>
                      <input
                        type="checkbox"
                        checked={calendar.isVisible}
                        onChange={(event) => {
                          const visible = event.target.checked;
                          void act(async () => {
                            await service.setVisibility(calendar.id, visible);
                            setCalendars((current) =>
                              current.map((item) =>
                                item.id === calendar.id ? { ...item, isVisible: visible } : item,
                              ),
                            );
                          });
                        }}
                      />
                      <span
                        className="calendar-swatch"
                        style={{ backgroundColor: calendar.color.background ?? "#b7bcc9" }}
                      />
                      <span>{calendar.displayName}</span>
                    </label>
                  ))
                ) : (
                  <p>No calendars found.</p>
                )}
              </fieldset>
            )}
          </>
        )}

        {error && (
          <div className="workspace-error" role="alert">
            <p>{error}</p>
            <button disabled={busy || loading} onClick={() => setRevision((value) => value + 1)}>
              Retry
            </button>
          </div>
        )}
      </section>

      <section>
        <h2>Timezone</h2>
        <p>{profile.timezone.replace(/_/g, " ")}</p>
        <p className="calendar-muted">Calendar and due dates use this timezone.</p>
      </section>

      <section>
        <h2>Account</h2>
        <button
          disabled={busy}
          onClick={() =>
            void act(async () => {
              await onSignOut();
            })
          }
        >
          Sign out
        </button>
      </section>
    </section>
  );
}
