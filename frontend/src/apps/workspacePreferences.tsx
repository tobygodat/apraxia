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
 * Device-local workspace preferences: the visual theme preset and whether the
 * sidebar is collapsed to its icon rail. They live in localStorage so they
 * follow the browser, not the account; a per-account service can replace the
 * store later without touching the consumers.
 */

export const WORKSPACE_THEME_PRESETS = ["classic", "ledger"] as const;
export type WorkspaceThemePreset = (typeof WORKSPACE_THEME_PRESETS)[number];

export interface WorkspacePreferences {
  readonly theme: WorkspaceThemePreset;
  readonly sidebarCollapsed: boolean;
}

export const DEFAULT_WORKSPACE_PREFERENCES: WorkspacePreferences = {
  theme: "classic",
  sidebarCollapsed: false,
};

export const WORKSPACE_THEME_LABELS: Record<
  WorkspaceThemePreset,
  { readonly name: string; readonly description: string }
> = {
  classic: {
    name: "Classic",
    description: "The original board: bordered day columns you scroll across.",
  },
  ledger: {
    name: "Ledger",
    description: "A ruled planner spread: big dates, hairline rows, the week in one view.",
  },
};

export interface WorkspacePreferencesStore {
  read(): WorkspacePreferences;
  write(next: WorkspacePreferences): void;
  subscribe(listener: () => void): () => void;
}

const STORAGE_KEY = "apraxia:workspace-preferences:v1";

function isThemePreset(value: unknown): value is WorkspaceThemePreset {
  return (
    typeof value === "string" && (WORKSPACE_THEME_PRESETS as readonly string[]).includes(value)
  );
}

export function normalizeWorkspacePreferences(value: unknown): WorkspacePreferences {
  if (!value || typeof value !== "object") return DEFAULT_WORKSPACE_PREFERENCES;
  const record = value as Record<string, unknown>;
  return {
    theme: isThemePreset(record.theme) ? record.theme : DEFAULT_WORKSPACE_PREFERENCES.theme,
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
  readonly setTheme: (theme: WorkspaceThemePreset) => void;
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
    (theme: WorkspaceThemePreset) => store.write({ ...store.read(), theme }),
    [store],
  );
  const setSidebarCollapsed = useCallback(
    (sidebarCollapsed: boolean) => store.write({ ...store.read(), sidebarCollapsed }),
    [store],
  );

  // The theme preset rides on the document root so any surface can style
  // against `[data-workspace-theme="ledger"]` without prop drilling.
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-workspace-theme", preferences.theme);
    return () => root.removeAttribute("data-workspace-theme");
  }, [preferences.theme]);

  const value = useMemo(
    () => ({ preferences, setTheme, setSidebarCollapsed }),
    [preferences, setTheme, setSidebarCollapsed],
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
      setTheme: () => {},
      setSidebarCollapsed: () => {},
    }
  );
}
