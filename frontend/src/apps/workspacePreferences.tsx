import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

/**
 * Device-local workspace preferences: the visual theme and whether the
 * sidebar is collapsed to its icon rail. They live in localStorage so they
 * follow the browser, not the account; a per-account service can replace the
 * store later without touching the consumers.
 *
 * The theme preset applies to the whole workspace, not to one page. `classic`
 * is the workspace as it ships today; `paper` and `paper-light` are the two
 * themes of the Toby Godat foundations, whose tokens live in `paper.css`.
 * `device` is not a fourth look: it is Paper, following the device between the
 * dark page and the light one, so `data-theme` only ever carries a real preset.
 */

export const WORKSPACE_THEME_PRESETS = ["classic", "paper", "paper-light"] as const;
export type WorkspaceThemePreset = (typeof WORKSPACE_THEME_PRESETS)[number];

export const WORKSPACE_THEME_CHOICES = [...WORKSPACE_THEME_PRESETS, "device"] as const;
export type WorkspaceThemeChoice = (typeof WORKSPACE_THEME_CHOICES)[number];

/**
 * How Paper fills a calendar event. `raised` is the neutral surface every event
 * shares; `tinted` washes each one with its calendar's colour. Classic fills
 * events with the calendar's colour outright, so the choice does not reach it.
 */
export const CALENDAR_EVENT_STYLES = ["raised", "tinted"] as const;
export type CalendarEventStyle = (typeof CALENDAR_EVENT_STYLES)[number];

export interface WorkspacePreferences {
  readonly theme: WorkspaceThemeChoice;
  readonly calendarEvents: CalendarEventStyle;
  readonly sidebarCollapsed: boolean;
}

export const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = {
  theme: "classic",
  calendarEvents: "raised",
  sidebarCollapsed: false,
};

export interface WorkspacePreferencesStore {
  read(): WorkspacePreferences;
  write(next: WorkspacePreferences): void;
  subscribe(listener: () => void): () => void;
}

export const WORKSPACE_PREFERENCES_STORAGE_KEY = "apraxia:workspace-preferences:v1";
const STORAGE_KEY = WORKSPACE_PREFERENCES_STORAGE_KEY;

function isOneOf<T extends string>(choices: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (choices as readonly string[]).includes(value);
}

const DEVICE_LIGHT_QUERY = "(prefers-color-scheme: light)";

function deviceLightQuery(): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(DEVICE_LIGHT_QUERY)
    : null;
}

function subscribeToDeviceScheme(listener: () => void): () => void {
  const query = deviceLightQuery();
  query?.addEventListener("change", listener);
  return () => query?.removeEventListener("change", listener);
}

/** The preset a choice paints with. Dark is Paper's default, so it is the fallback. */
export function resolveWorkspaceTheme(
  theme: WorkspaceThemeChoice,
  deviceIsLight: boolean,
): WorkspaceThemePreset {
  if (theme !== "device") return theme;
  return deviceIsLight ? "paper-light" : "paper";
}

export function normalizeWorkspacePreferences(value: unknown): WorkspacePreferences {
  if (!value || typeof value !== "object") return DEFAULT_WORKSPACE_PREFERENCES;
  const record = value as Record<string, unknown>;
  return {
    theme: isOneOf(WORKSPACE_THEME_CHOICES, record.theme)
      ? record.theme
      : DEFAULT_WORKSPACE_PREFERENCES.theme,
    calendarEvents: isOneOf(CALENDAR_EVENT_STYLES, record.calendarEvents)
      ? record.calendarEvents
      : DEFAULT_WORKSPACE_PREFERENCES.calendarEvents,
    sidebarCollapsed:
      typeof record.sidebarCollapsed === "boolean"
        ? record.sidebarCollapsed
        : DEFAULT_WORKSPACE_PREFERENCES.sidebarCollapsed,
  };
}

/** Browser-local store. Safe when storage is unavailable: falls back to memory. */
export function createLocalWorkspacePreferencesStore(
  storage: Pick<Storage, "getItem" | "setItem"> | null = safeLocalStorage(),
  key = STORAGE_KEY,
): WorkspacePreferencesStore {
  const listeners = new Set<() => void>();
  let cached: WorkspacePreferences | null = null;

  const load = (): WorkspacePreferences => {
    if (cached) return cached;
    let parsed: unknown;
    try {
      const raw = storage?.getItem(key);
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }
    cached = normalizeWorkspacePreferences(parsed);
    return cached;
  };

  return {
    read: load,
    write(next) {
      cached = normalizeWorkspacePreferences(next);
      try {
        storage?.setItem(key, JSON.stringify(cached));
      } catch {
        // Storage may be full or blocked; the in-memory value still applies.
      }
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** In-memory store for tests and fixtures. */
export function createMemoryWorkspacePreferencesStore(
  initial: Partial<WorkspacePreferences> = {},
): WorkspacePreferencesStore {
  return createLocalWorkspacePreferencesStore(
    {
      getItem: () => JSON.stringify({ ...DEFAULT_WORKSPACE_PREFERENCES, ...initial }),
      setItem: () => {},
    },
    STORAGE_KEY,
  );
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

interface WorkspacePreferencesContextValue {
  readonly preferences: WorkspacePreferences;
  /** The preset on screen: `preferences.theme` with `device` already answered. */
  readonly resolvedTheme: WorkspaceThemePreset;
  readonly setTheme: (theme: WorkspaceThemeChoice) => void;
  readonly setCalendarEvents: (calendarEvents: CalendarEventStyle) => void;
  readonly setSidebarCollapsed: (collapsed: boolean) => void;
}

const fallbackStore = createLocalWorkspacePreferencesStore();

const WorkspacePreferencesContext = createContext<WorkspacePreferencesContextValue | null>(null);

export function WorkspacePreferencesProvider({
  store = fallbackStore,
  children,
}: {
  readonly store?: WorkspacePreferencesStore;
  readonly children?: ReactNode;
}) {
  const preferences = useSyncExternalStore(store.subscribe, store.read, store.read);

  const setTheme = useCallback(
    (theme: WorkspaceThemeChoice) => store.write({ ...store.read(), theme }),
    [store],
  );
  const setCalendarEvents = useCallback(
    (calendarEvents: CalendarEventStyle) => store.write({ ...store.read(), calendarEvents }),
    [store],
  );
  const setSidebarCollapsed = useCallback(
    (sidebarCollapsed: boolean) => store.write({ ...store.read(), sidebarCollapsed }),
    [store],
  );

  const deviceIsLight = useSyncExternalStore(
    subscribeToDeviceScheme,
    () => deviceLightQuery()?.matches ?? false,
    () => false,
  );
  const resolvedTheme = resolveWorkspaceTheme(preferences.theme, deviceIsLight);

  // The preset rides on the document root so any surface can style against
  // `[data-theme]` without prop drilling. `paper.css` answers to the two Paper
  // values; classic is the absence of a Paper value, which is why it needs no
  // rules of its own.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", resolvedTheme);
    return () => root.removeAttribute("data-theme");
  }, [resolvedTheme]);

  // The event style rides beside it for the same reason: the week's sheet
  // answers to the attribute, and the grid never has to be told.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-calendar-events", preferences.calendarEvents);
    return () => root.removeAttribute("data-calendar-events");
  }, [preferences.calendarEvents]);

  const value = useMemo(
    () => ({ preferences, resolvedTheme, setTheme, setCalendarEvents, setSidebarCollapsed }),
    [preferences, resolvedTheme, setTheme, setCalendarEvents, setSidebarCollapsed],
  );

  return (
    <WorkspacePreferencesContext.Provider value={value}>
      {children}
    </WorkspacePreferencesContext.Provider>
  );
}

/** Works outside a provider too (defaults, no-op writers) so isolated renders stay simple. */
export function useWorkspacePreferences(): WorkspacePreferencesContextValue {
  const context = useContext(WorkspacePreferencesContext);
  return (
    context ?? {
      preferences: DEFAULT_WORKSPACE_PREFERENCES,
      resolvedTheme: resolveWorkspaceTheme(DEFAULT_WORKSPACE_PREFERENCES.theme, false),
      setTheme: () => {},
      setCalendarEvents: () => {},
      setSidebarCollapsed: () => {},
    }
  );
}
