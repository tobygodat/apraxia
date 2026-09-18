import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AuthIdentity } from "../auth/authPort";
import type { ClassSummary, Profile, ProjectSummary } from "../types/domain";
import { NavigationCache } from "./navigationCache";
import type { WorkspaceData } from "./workspaceData";

/** Returning to the tab revalidates only when the snapshot is at least this old. */
export const FOCUS_REVALIDATE_TTL = 60_000;

export interface WorkspaceDialogs {
  /** Ref-backed: opening a dialog never rerenders the workspace tree. */
  readonly isOpen: () => boolean;
  readonly register: () => () => void;
}

export interface WorkspaceStore {
  readonly profile: Profile | null;
  readonly profileError: boolean;
  readonly projects: readonly ProjectSummary[];
  /** Class choices for task forms; empty when the account has no class storage. */
  readonly classes: readonly ClassSummary[];
  /** True when project or class choices could not load. */
  readonly projectError: boolean;
  /** Increments after invalidate(); visible pages reload their data. */
  readonly revision: number;
  /** Drop cached reads after a write, then reload profile, projects, and pages. */
  readonly invalidate: () => void;
  readonly retryProfile: () => void;
  readonly dialogs: WorkspaceDialogs;
}

const DETACHED_DIALOGS: WorkspaceDialogs = { isOpen: () => false, register: () => () => undefined };
/** Standalone slices (QA fixtures, unit tests) run without a provider. */
const DETACHED: WorkspaceStore = {
  profile: null,
  profileError: false,
  projects: [],
  classes: [],
  projectError: false,
  revision: 0,
  invalidate: () => undefined,
  retryProfile: () => undefined,
  dialogs: DETACHED_DIALOGS,
};

export const WorkspaceContext = createContext<WorkspaceStore | null>(null);

export function useWorkspace(): WorkspaceStore {
  return useContext(WorkspaceContext) ?? DETACHED;
}

export function useWorkspaceRevision(): number {
  return useWorkspace().revision;
}

/** Counts an open dialog so shell shortcuts (Ctrl+K) stay out of modal flows. */
export function useDialogPresence(open = true): void {
  const { dialogs } = useWorkspace();
  useLayoutEffect(() => (open ? dialogs.register() : undefined), [dialogs, open]);
}

export function WorkspaceProvider({
  identity,
  workspaceData,
  cache,
  children,
}: {
  readonly identity: AuthIdentity;
  readonly workspaceData: Pick<WorkspaceData, "profile" | "projects" | "classes">;
  readonly cache?: NavigationCache;
  readonly children: ReactNode;
}) {
  const ownCache = useMemo(() => cache ?? new NavigationCache(), [cache]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState(false);
  const [projects, setProjects] = useState<readonly ProjectSummary[]>([]);
  const [projectError, setProjectError] = useState(false);
  const [classes, setClasses] = useState<readonly ClassSummary[]>([]);
  const [classError, setClassError] = useState(false);
  const [revision, setRevision] = useState(0);
  const [profileRevision, setProfileRevision] = useState(0);
  const validatedAt = useRef(Date.now());
  const invalidate = useCallback(() => {
    ownCache.invalidate();
    validatedAt.current = Date.now();
    setRevision((v) => v + 1);
  }, [ownCache]);
  // Retry has to drop the cached entry first: a well-formed value the store
  // rejected (an owner mismatch, a bad snapshot) is still cached, so without
  // this the retry re-reads the same value until the TTL expires.
  const retryProfile = useCallback(() => {
    ownCache.invalidate();
    validatedAt.current = Date.now();
    setProfileRevision((v) => v + 1);
  }, [ownCache]);
  const dialogs = useMemo<WorkspaceDialogs>(() => {
    let count = 0;
    return {
      isOpen: () => count > 0,
      register: () => {
        count += 1;
        return () => {
          count -= 1;
        };
      },
    };
  }, []);

  useEffect(() => {
    const onFocus = () => {
      if (Date.now() - validatedAt.current >= FOCUS_REVALIDATE_TTL) invalidate();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [invalidate]);

  useEffect(() => {
    const controller = new AbortController();
    setProfileError(false);
    void ownCache
      .read("workspace:profile", (signal) => workspaceData.profile(signal), controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        if (value.userId !== identity.userId) {
          setProfileError(true);
          return;
        }
        setProfile(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setProfileError(true);
      });
    return () => controller.abort();
  }, [ownCache, workspaceData, identity.userId, revision, profileRevision]);

  useEffect(() => {
    const controller = new AbortController();
    void ownCache
      .read("workspace:projects", (signal) => workspaceData.projects(signal), controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) {
          setProjects(value);
          setProjectError(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setProjectError(true);
      });
    return () => controller.abort();
  }, [ownCache, workspaceData, revision]);

  useEffect(() => {
    const controller = new AbortController();
    const classService = workspaceData.classes;
    void ownCache
      .read(
        "workspace:classes",
        (signal) => classService?.list(identity.userId, signal) ?? Promise.resolve([]),
        controller.signal,
      )
      .then((value) => {
        if (!controller.signal.aborted) {
          setClasses(value.map(({ id, name }) => ({ id, name })));
          setClassError(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setClassError(true);
      });
    return () => controller.abort();
  }, [ownCache, workspaceData, identity.userId, revision]);

  const store = useMemo<WorkspaceStore>(
    () => ({
      profile,
      profileError,
      projects,
      classes,
      projectError: projectError || classError,
      revision,
      invalidate,
      retryProfile,
      dialogs,
    }),
    [
      profile,
      profileError,
      projects,
      classes,
      projectError,
      classError,
      revision,
      invalidate,
      retryProfile,
      dialogs,
    ],
  );
  return <WorkspaceContext.Provider value={store}>{children}</WorkspaceContext.Provider>;
}
