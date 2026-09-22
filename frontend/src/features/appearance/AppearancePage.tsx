import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import {
  CALENDAR_EVENT_STYLES,
  WORKSPACE_THEME_CHOICES,
  resolveWorkspaceTheme,
  useWorkspacePreferences,
  type CalendarEventStyle,
  type WorkspaceThemeChoice,
} from "../../apps/workspacePreferences";
import { canRunViewTransition } from "../../lib/viewTransition";
// Appearance is a page of ruled choices like Settings, so it wears the same
// sheets rather than a copy of them.
import "../calendar/calendar.css";
import "../calendar/settingsPaper.css";
import "../calendar/calendarCrisp.css";

interface ChoiceCopy {
  readonly name: string;
  readonly description: string;
}

/**
 * What each choice is called and what it does. The names are interface words,
 * so Paper lowercases them; Crisp and classic print them as written.
 */
const THEME_COPY: Record<WorkspaceThemeChoice, ChoiceCopy> = {
  crisp: {
    name: "Crisp",
    description: "A clean sans, warm greys and one blue, on a dark page.",
  },
  "crisp-light": {
    name: "Crisp light",
    description: "The same page in daylight.",
  },
  classic: {
    name: "Classic",
    description: "Charcoal surfaces and Georgia headings, the workspace before Crisp.",
  },
  paper: {
    name: "Paper",
    description: "Warm dark paper, Literata throughout, rules instead of boxes.",
  },
  "paper-light": {
    name: "Paper light",
    description: "The same page on light paper.",
  },
  device: {
    name: "Match device",
    description: "Crisp when this device is in dark mode, Crisp light when it is in light mode.",
  },
};

const CALENDAR_EVENT_COPY: Record<CalendarEventStyle, ChoiceCopy> = {
  raised: {
    name: "Raised",
    description:
      "Every event on the same neutral surface, with its calendar's colour kept to the rule at its left.",
  },
  tinted: {
    name: "Tinted",
    description: "Each event filled with a faint wash of its calendar's colour.",
  },
};

const SIDEBAR_CHOICES = ["expanded", "collapsed"] as const;
type SidebarChoice = (typeof SIDEBAR_CHOICES)[number];

const SIDEBAR_COPY: Record<SidebarChoice, ChoiceCopy> = {
  expanded: { name: "Words", description: "Each section shows its icon and its name." },
  collapsed: {
    name: "Icons only",
    description: "A narrow rail that leaves more room for the page.",
  },
};

/** One ruled list of radios: a name per choice and a sentence describing it. */
function ChoiceGroup<T extends string>({
  id,
  title,
  choices,
  copy,
  note,
  value,
  onChange,
}: {
  id: string;
  title: string;
  choices: readonly T[];
  copy: Record<T, ChoiceCopy>;
  /** A sentence under the heading, for what the whole group needs said once. */
  note?: string;
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <section>
      {/* The heading names the group, so there is no legend repeating it. */}
      <h2 className="paper-heading settings-heading" id={`${id}-title`}>
        {title}
      </h2>
      {note ? <p className="calendar-muted">{note}</p> : null}
      <fieldset role="radiogroup" aria-labelledby={`${id}-title`}>
        <div className="settings-list">
          {choices.map((choice) => (
            <label key={choice} className="paper-row settings-choice">
              {/* The name alone names the control; the sentence describes it,
                  rather than both running together into one long label. */}
              <input
                className="paper-radio"
                type="radio"
                name={id}
                value={choice}
                checked={value === choice}
                onChange={() => onChange(choice)}
                aria-label={copy[choice].name}
                aria-describedby={`${id}-${choice}-note`}
              />
              <span className="settings-choice__name">{copy[choice].name}</span>
              <span className="settings-choice__note" id={`${id}-${choice}-note`}>
                {copy[choice].description}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </section>
  );
}

/**
 * Changing theme paints the new one outward from where you clicked: a view
 * transition whose new page opens as a circle over the old. Where a view
 * transition cannot run the theme simply changes.
 */
function useThemeReveal(setTheme: (theme: WorkspaceThemeChoice) => void) {
  const pointer = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const remember = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
    };
    window.addEventListener("pointerdown", remember, true);
    return () => window.removeEventListener("pointerdown", remember, true);
  }, []);

  return (next: WorkspaceThemeChoice) => {
    if (!canRunViewTransition()) {
      setTheme(next);
      return;
    }
    const root = document.documentElement;
    const origin = pointer.current;
    pointer.current = null;
    root.style.setProperty("--reveal-x", origin ? `${origin.x}px` : "50%");
    root.style.setProperty("--reveal-y", origin ? `${origin.y}px` : "50%");
    root.classList.add("theme-revealing");
    const deviceIsLight = window.matchMedia("(prefers-color-scheme: light)").matches;
    const transition = document.startViewTransition(() => {
      flushSync(() => setTheme(next));
      // The provider sets this in an effect; set it here too so the new
      // snapshot is taken in the new theme.
      root.setAttribute("data-theme", resolveWorkspaceTheme(next, deviceIsLight));
    });
    void transition.finished.finally(() => root.classList.remove("theme-revealing"));
  };
}

export function AppearancePage() {
  const { preferences, setTheme, setCalendarEvents, setSidebarCollapsed } =
    useWorkspacePreferences();
  const revealTheme = useThemeReveal(setTheme);
  return (
    <section className="calendar-settings" aria-labelledby="appearance-title">
      <h1 id="appearance-title">Appearance</h1>
      <p className="calendar-muted">These choices are saved on this device only.</p>
      <ChoiceGroup
        id="appearance-theme"
        title="Theme"
        choices={WORKSPACE_THEME_CHOICES}
        copy={THEME_COPY}
        value={preferences.theme}
        onChange={revealTheme}
      />
      <ChoiceGroup
        id="appearance-calendar-events"
        title="Calendar events"
        choices={CALENDAR_EVENT_STYLES}
        copy={CALENDAR_EVENT_COPY}
        note="How Crisp and Paper fill an event on the week. Classic keeps its own colours."
        value={preferences.calendarEvents}
        onChange={setCalendarEvents}
      />
      <ChoiceGroup
        id="appearance-sidebar"
        title="Sidebar"
        choices={SIDEBAR_CHOICES}
        copy={SIDEBAR_COPY}
        value={preferences.sidebarCollapsed ? "collapsed" : "expanded"}
        onChange={(next) => setSidebarCollapsed(next === "collapsed")}
      />
    </section>
  );
}
