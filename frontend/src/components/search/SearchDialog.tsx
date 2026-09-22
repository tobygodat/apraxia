import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CollectionService } from "../../features/collections/collectionService";
import type { SearchRecordType, SearchResult } from "../../types/domain";
import { useDialogPresence, useWorkspaceRevision } from "../../apps/workspaceStore";
import { matchPages, stepHighlight } from "./searchPages";
import "./SearchDialog.css";
import "./searchPaper.css";
import "./searchCrisp.css";

export interface SearchDialogProps {
  open: boolean;
  service: Pick<CollectionService, "search">;
  onClose: () => void;
  onSelect: (result: SearchResult) => Promise<void> | void;
  /** Lists the workspace pages above the results; without it the dialog only finds records. */
  onNavigate?: (to: string) => void;
}

/** The interface says "Tasks" where the database says todos, and "note" reads better than the column name. */
const RESULT_KIND: Record<SearchRecordType, string> = {
  todo: "task",
  assignment: "assignment",
  idea: "idea",
  project: "project",
  class: "class",
  class_note: "note",
  application: "application",
};

/** Remains mounted in the authenticated shell so closing search keeps its place. */
export function SearchDialog({ open, service, onClose, onSelect, onNavigate }: SearchDialogProps) {
  const id = useId();
  const refreshKey = useWorkspaceRevision();
  useDialogPresence(open);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestGeneration = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const selectingRef = useRef(false);
  const alive = useRef(true);
  const loadedRefreshKey = useRef(refreshKey);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loadedQuery, setLoadedQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [selection, setSelection] = useState<string | null>(null);
  const [nextOffset, setNextOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  // The first row starts highlighted so Enter always does something.
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      requestGeneration.current += 1;
      requestController.current?.abort();
    };
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    inputRef.current?.focus();
    return () => {
      document.body.style.overflow = oldOverflow;
      // An editor opened by search owns focus; do not pull it back to the shell.
      queueMicrotask(() => {
        if (
          (document.activeElement === document.body || document.activeElement === null) &&
          previous?.isConnected
        )
          previous.focus();
      });
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      requestGeneration.current += 1;
      requestController.current?.abort();
      setLoading(false);
      return;
    }
    const searchQuery = query.trim();
    if (!searchQuery) {
      setResults([]);
      setLoadedQuery("");
      setHasMore(false);
      setNextOffset(0);
      setError("");
      setLoading(false);
      return;
    }
    if (searchQuery === loadedQuery && retry === 0 && loadedRefreshKey.current === refreshKey) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      void fetchResults(searchQuery, 0);
    }, 200);
    return () => {
      window.clearTimeout(timer);
      requestGeneration.current += 1;
      requestController.current?.abort();
    };
    // loadedQuery is the receipt of this request, not a trigger for another one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, service, retry, refreshKey]);

  async function fetchResults(searchQuery: string, offset: number) {
    const generation = ++requestGeneration.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setLoading(true);
    setError("");
    try {
      const page = await service.search(searchQuery, offset, controller.signal);
      if (!alive.current || generation !== requestGeneration.current) return;
      setResults((current) =>
        offset === 0
          ? page
          : [...current, ...page].filter(
              (row, index, all) =>
                all.findIndex(
                  (other) => other.recordId === row.recordId && other.recordType === row.recordType,
                ) === index,
            ),
      );
      setLoadedQuery(searchQuery);
      loadedRefreshKey.current = refreshKey;
      setNextOffset(offset + page.length);
      setHasMore(page.length === 40 && offset + page.length < (page[0]?.totalCount ?? 0));
    } catch {
      if (alive.current && generation === requestGeneration.current)
        setError("Couldn’t search. Your query and previous results are still here. Try again.");
    } finally {
      if (alive.current && generation === requestGeneration.current) setLoading(false);
    }
  }

  function updateQuery(value: string) {
    requestGeneration.current += 1;
    requestController.current?.abort();
    setQuery(value.slice(0, 256));
    setHighlight(0);
    setError("");
    setRetry(0);
  }

  async function select(result: SearchResult) {
    if (selectingRef.current) return;
    selectingRef.current = true;
    dialogRef.current?.querySelector<HTMLButtonElement>(".search-header button")?.focus();
    setSelection(`${result.recordType}:${result.recordId}`);
    setError("");
    try {
      await onSelect(result);
    } catch {
      if (alive.current) setError("Couldn’t open this record. It may have changed. Try again.");
    } finally {
      selectingRef.current = false;
      if (alive.current) setSelection(null);
    }
  }

  function close() {
    if (!selectingRef.current) onClose();
  }

  const pages = onNavigate ? matchPages(query) : [];
  const rowCount = pages.length + results.length;
  const highlighted = Math.min(highlight, rowCount - 1);
  const rowId = (index: number) => `${id}-row-${index}`;

  function activate(index: number) {
    if (index < 0) return;
    const page = pages[index];
    if (page) onNavigate?.(page.to);
    else void select(results[index - pages.length]);
  }
  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = stepHighlight(highlighted, event.key === "ArrowDown" ? 1 : -1, rowCount);
      setHighlight(next);
      // Optional call: happy-dom has no scrollIntoView.
      document.getElementById(rowId(next))?.scrollIntoView?.({ block: "nearest" });
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      activate(highlighted);
    }
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const controls = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        "input:not(:disabled),button:not(:disabled)",
      ) ?? [],
    );
    const first = controls[0],
      last = controls[controls.length - 1];
    if (!first) {
      event.preventDefault();
      dialogRef.current?.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  if (!open) return null;
  const previousResults = Boolean(results.length && loadedQuery !== query.trim());
  return createPortal(
    <div className="search-backdrop">
      <div
        className="search-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="search-header">
          <h2 id={`${id}-title`}>Search</h2>
          <button
            type="button"
            className="paper-action paper-action--quiet"
            aria-disabled={Boolean(selection)}
            onClick={close}
          >
            Close
          </button>
        </header>
        <label className="search-label" htmlFor={`${id}-query`}>
          Find a task, assignment, class, note, idea, or project
        </label>
        <input
          className="search-input"
          ref={inputRef}
          id={`${id}-query`}
          type="search"
          autoComplete="off"
          maxLength={256}
          value={query}
          disabled={Boolean(selection)}
          aria-controls={`${id}-rows`}
          aria-activedescendant={highlighted >= 0 ? rowId(highlighted) : undefined}
          onChange={(event) => updateQuery(event.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="Search your workspace"
        />
        {error && (
          <div className="search-error paper-error" role="alert">
            <p>{error}</p>
            {!selection && (
              <button type="button" onClick={() => setRetry((value) => value + 1)}>
                Retry search
              </button>
            )}
          </div>
        )}
        <div className="search-status" role="status">
          {selection
            ? "Opening record…"
            : loading
              ? "Searching…"
              : !query.trim()
                ? "Search includes completed tasks and archived projects."
                : !results.length && !error
                  ? pages.length
                    ? "No matching records."
                    : "No matches. Try another word."
                  : previousResults
                    ? `Previous results for “${loadedQuery}”`
                    : `${results.length} ${results.length === 1 ? "result" : "results"}${hasMore ? " shown" : ""}`}
        </div>
        <div id={`${id}-rows`}>
          {pages.length > 0 && (
            <>
              <h3 className="search-group" id={`${id}-pages`}>
                Go to
              </h3>
              <ul className="search-results" aria-labelledby={`${id}-pages`}>
                {pages.map((page, index) => (
                  <li key={page.to}>
                    <button
                      type="button"
                      id={rowId(index)}
                      data-highlighted={index === highlighted ? "" : undefined}
                      disabled={Boolean(selection)}
                      onMouseMove={() => setHighlight(index)}
                      onClick={() => onNavigate?.(page.to)}
                    >
                      <span className="search-result-type">page</span>
                      <span className="search-result-content">
                        <strong className="search-page-name">{page.label}</strong>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {pages.length > 0 && results.length > 0 && (
            <h3 className="search-group" id={`${id}-records`}>
              Records
            </h3>
          )}
          <ul className="search-results" aria-label="Search results">
            {results.map((result, index) => (
              <li key={`${result.recordType}:${result.recordId}`}>
                <button
                  type="button"
                  id={rowId(pages.length + index)}
                  data-highlighted={pages.length + index === highlighted ? "" : undefined}
                  disabled={Boolean(selection)}
                  onMouseMove={() => setHighlight(pages.length + index)}
                  onClick={() => void select(result)}
                >
                  <span className="search-result-type">{RESULT_KIND[result.recordType]}</span>
                  <span className="search-result-content">
                    <strong>
                      {result.title ||
                        result.snippet.split(/\r?\n/).find((line) => line.trim()) ||
                        "Untitled"}
                    </strong>
                    {result.parentId && (
                      <span className="search-result-parent">{result.parentId}</span>
                    )}
                    {result.snippet && <span>{result.snippet}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        {hasMore && !previousResults && (
          <button
            type="button"
            className="search-more paper-action"
            disabled={loading || Boolean(selection)}
            onClick={() => void fetchResults(loadedQuery, nextOffset)}
          >
            Load more
          </button>
        )}
        <p className="search-foot">Enter to open · arrows to move · esc to close</p>
      </div>
    </div>,
    document.body,
  );
}
