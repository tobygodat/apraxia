import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { LocalDate, ClassSummary, ProjectSummary, Todo } from "../../types/domain";
import { TodoComposerDialog } from "../../features/todos/TodoComposerDialog";
import type { TodoService } from "../../features/todos/todoService";
import "./GlobalAddTodoController.css";

export interface OpenTodoComposerOptions {
  readonly initialDueDate?: LocalDate | null;
}

export interface GlobalAddTodoActions {
  /**
   * Opens the same compact Todo form from the shell or a contextual route
   * control. A second request while the form is open never replaces entered
   * values.
   */
  readonly openTodoComposer: (options?: OpenTodoComposerOptions) => void;
}

interface ComposerState {
  readonly scope: object | null;
  readonly open: boolean;
  readonly initialDueDate: LocalDate | null;
}

export interface GlobalAddTodoControllerProps {
  /** Lifecycle identity only. It is never sent to TodoService as ownership. */
  readonly workspaceSessionKey: string;
  readonly service: Pick<TodoService, "createTodo">;
  readonly projects: readonly ProjectSummary[];
  readonly classes?: readonly ClassSummary[];
  /** Synchronously reconcile the saved row into the current local view. */
  readonly onCreated: (todo: Todo) => undefined;
  readonly children: ReactNode;
}

const CLOSED_COMPOSER: ComposerState = {
  scope: null,
  open: false,
  initialDueDate: null,
};

const GlobalAddTodoContext = createContext<GlobalAddTodoActions | null>(null);

/**
 * Provider-neutral owner for the Phase 2 global Add Todo slice. A concrete
 * Supabase adapter is intentionally outside this component; the controller
 * only depends on the browser-facing TodoService contract.
 */
export function GlobalAddTodoController({
  workspaceSessionKey,
  service,
  projects,
  classes = [],
  onCreated,
  children,
}: GlobalAddTodoControllerProps) {
  const [composer, setComposer] = useState<ComposerState>(CLOSED_COMPOSER);
  const scope = useMemo(() => ({}), [service, workspaceSessionKey]);
  const activeScopeRef = useRef<object | null>(null);
  const [refreshIssueScope, setRefreshIssueScope] = useState<object | null>(null);
  const currentComposer = composer.scope === scope ? composer : CLOSED_COMPOSER;

  useLayoutEffect(() => {
    activeScopeRef.current = scope;
    return () => {
      activeScopeRef.current = null;
    };
  }, [scope]);

  const openTodoComposer = useCallback(
    (options: OpenTodoComposerOptions = {}) => {
      if (activeScopeRef.current !== scope) {
        return;
      }

      setComposer((current) =>
        current.scope === scope && current.open
          ? current
          : {
              scope,
              open: true,
              initialDueDate: options.initialDueDate ?? null,
            },
      );
    },
    [scope],
  );

  const closeTodoComposer = useCallback(() => {
    if (activeScopeRef.current === scope) {
      setComposer(CLOSED_COMPOSER);
    }
  }, [scope]);

  const actions = useMemo<GlobalAddTodoActions>(
    () => ({ openTodoComposer }),
    [openTodoComposer],
  );

  return (
    <GlobalAddTodoContext.Provider value={actions}>
      {children}
      {refreshIssueScope === scope ? (
        <aside className="global-add-notice" aria-label="Task added">
          <p role="status">Task added, but this view may be out of date. Refresh to see it.</p>
          <button type="button" onClick={() => setRefreshIssueScope(null)}>Dismiss</button>
        </aside>
      ) : null}
      <TodoComposerDialog
        initialDueDate={currentComposer.initialDueDate}
        onClose={closeTodoComposer}
        onCreate={async (input, options) => {
          if (activeScopeRef.current !== scope || options.signal.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }

          const created = await service.createTodo(input, options);

          if (activeScopeRef.current !== scope || options.signal.aborted) {
            throw new DOMException("Aborted", "AbortError");
          }

          // Persistence already succeeded. A view-reconciliation error must
          // never leave an Add form inviting the user to create a duplicate.
          try {
            onCreated(created);
            setRefreshIssueScope(null);
          } catch {
            setRefreshIssueScope(scope);
          }
        }}
        open={currentComposer.open}
        projects={projects} classes={classes}
      />
    </GlobalAddTodoContext.Provider>
  );
}

export function useGlobalAddTodo(): GlobalAddTodoActions {
  const actions = useContext(GlobalAddTodoContext);

  if (!actions) {
    throw new Error(
      "useGlobalAddTodo must be used inside GlobalAddTodoController.",
    );
  }

  return actions;
}
