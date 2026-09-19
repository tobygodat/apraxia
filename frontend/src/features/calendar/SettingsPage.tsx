import { useEffect, useMemo, useState } from "react";
import type {
  CalendarPreference,
  GoogleCalendarConnectionStatus,
  Profile,
} from "../../types/domain";
import type { CalendarService } from "./calendarService";
import "./calendar.css";
import "./settingsPaper.css";
import { serviceErrorMessage } from "../../lib/serviceError";
import {
  WORKSPACE_THEME_PRESETS,
  useWorkspacePreferences,
  type WorkspaceThemePreset,
} from "../../apps/workspacePreferences";
import { peekRead } from "../../apps/navigationCache";
import { useColdLoad } from "../../apps/coldLoad";

/**
 * What each preset is called and what it looks like. The names are interface
 * words, so Paper lowercases them; classic prints them as written.
 */
const THEME_COPY: Record<WorkspaceThemePreset, { name: string; description: string }> = {
  classic: {
    name: "Classic",
    description: "Charcoal surfaces, Georgia headings, the workspace as it is today.",
  },
  paper: {
    name: "Paper",
    description: "Warm dark paper, Literata throughout, rules instead of boxes.",
  },
  "paper-light": {
    name: "Paper light",
    description: "The same page on light paper.",
  },
};

/** `Intl.supportedValuesOf` is ES2022; this build targets ES2020. */
type IntlWithSupportedValues = typeof Intl & {
  supportedValuesOf?: (key: "timeZone") => readonly string[];
};

/**
 * Every zone this browser knows, with the saved one kept in the list even when
 * the browser does not offer it, so the current setting is never silently lost.
 */
export function timezoneChoices(current: string): string[] {
  let supported: readonly string[];
  try {
    supported = (Intl as IntlWithSupportedValues).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    supported = [];
  }
  const choices = new Set(supported);
  choices.add(current);
  return [...choices].sort((left, right) => left.localeCompare(right));
}

export function SettingsPage({
  calendarService: service,
  profile,
  onSignOut,
  onSaveTimezone,
}: {
  calendarService: CalendarService;
  profile: Profile;
  onSignOut: () => void | Promise<void>;
  /** Omitted by fixtures and tests, which render the timezone read-only. */
  onSaveTimezone?: (timezone: string) => Promise<void>;
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
  const [timezone, setTimezone] = useState(profile.timezone);
  const [timezoneBusy, setTimezoneBusy] = useState(false);
  const [timezoneError, setTimezoneError] = useState<string | null>(null);
  const [timezoneNotice, setTimezoneNotice] = useState("");
  const timezoneOptions = useMemo(() => timezoneChoices(profile.timezone), [profile.timezone]);
  useEffect(() => setTimezone(profile.timezone), [profile.timezone]);
  const saveTimezone = (next: string) => {
    if (!onSaveTimezone || next === timezone) return;
    const previous = timezone;
    setTimezone(next);
    setTimezoneBusy(true);
    setTimezoneError(null);
    setTimezoneNotice("");
    void (async () => {
      try {
        await onSaveTimezone(next);
        setTimezoneNotice(`Timezone saved as ${next.replace(/_/g, " ")}.`);
      } catch (reason) {
        setTimezone(previous);
        setTimezoneError(serviceErrorMessage(reason, "Your timezone wasn’t saved. Try again."));
      } finally {
        setTimezoneBusy(false);
      }
    })();
  };
  const { preferences, setTheme } = useWorkspacePreferences();
  useColdLoad(loading && status === null && !error);
  return (
    <section className="calendar-settings" aria-labelledby="calendar-settings-title">
      <h1 id="calendar-settings-title">Settings</h1>

      <section>
        {/* The heading names the group, so there is no legend repeating it. */}
        <h2 className="paper-heading settings-heading" id="settings-appearance-title">
          Appearance
        </h2>
        <fieldset role="radiogroup" aria-labelledby="settings-appearance-title">
          <div className="settings-list">
            {WORKSPACE_THEME_PRESETS.map((preset) => (
              <label key={preset} className="paper-row settings-choice">
                {/* The name alone names the control; the sentence describes it,
                    rather than both running together into one long label. */}
                <input
                  className="paper-radio"
                  type="radio"
                  name="workspace-theme"
                  value={preset}
                  checked={preferences.theme === preset}
                  onChange={() => setTheme(preset)}
                  aria-label={THEME_COPY[preset].name}
                  aria-describedby={`settings-theme-${preset}-note`}
                />
                <span className="settings-choice__name">{THEME_COPY[preset].name}</span>
                <span className="settings-choice__note" id={`settings-theme-${preset}-note`}>
                  {THEME_COPY[preset].description}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <p className="calendar-muted">This choice is saved on this device only.</p>
      </section>

      <section>
        <h2 className="paper-heading">Google Calendar</h2>
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
                  className="paper-action paper-action--completing"
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
                  className="paper-action paper-action--danger"
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
                  <div className="settings-list">
                    {calendars.map((calendar) => (
                      <label key={calendar.id} className="paper-row settings-calendar">
                        <input
                          className="paper-check"
                          type="checkbox"
                          checked={calendar.isVisible}
                          onChange={(event) => {
                            const visible = event.target.checked;
                            const applyVisibility = (isVisible: boolean) =>
                              setCalendars((current) =>
                                current.map((item) =>
                                  item.id === calendar.id ? { ...item, isVisible } : item,
                                ),
                              );
                            // Show the tick immediately and roll back on failure:
                            // waiting for the round trip made the box look stuck.
                            applyVisibility(visible);
                            void act(async () => {
                              try {
                                await service.setVisibility(calendar.id, visible);
                              } catch (reason) {
                                applyVisibility(!visible);
                                throw reason;
                              }
                            });
                          }}
                        />
                        <span
                          className="calendar-swatch"
                          style={{ backgroundColor: calendar.color.background ?? "#b7bcc9" }}
                        />
                        <span>{calendar.displayName}</span>
                      </label>
                    ))}
                  </div>
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
        <h2 className="paper-heading settings-heading">Timezone</h2>
        {onSaveTimezone ? (
          <>
            {/* The section heading already names it; the label is for the control. */}
            <label className="cloud-shell__sr-only" htmlFor="settings-timezone">
              Timezone
            </label>
            <select
              className="paper-field"
              id="settings-timezone"
              value={timezone}
              disabled={timezoneBusy}
              onChange={(event) => saveTimezone(event.target.value)}
            >
              {timezoneOptions.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace(/_/g, " ")}
                </option>
              ))}
            </select>
            <p className="cloud-shell__sr-only" role="status">
              {timezoneBusy ? "Saving your timezone…" : timezoneNotice}
            </p>
            {timezoneError && (
              <div className="workspace-error" role="alert">
                <p>{timezoneError}</p>
              </div>
            )}
          </>
        ) : (
          <p>{profile.timezone.replace(/_/g, " ")}</p>
        )}
        <p className="calendar-muted">
          Calendar and due dates use this timezone. Changing it clears the manual Today order for
          any task whose due date no longer lands on today.
        </p>
      </section>

      <section>
        <h2 className="paper-heading settings-heading">Account</h2>
        <button
          className="paper-action"
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
