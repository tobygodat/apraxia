import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CollectionService } from "../../features/collections/collectionService";
import type { SearchResult } from "../../types/domain";
import { useDialogPresence, useWorkspaceRevision } from "../../apps/workspaceStore";
import "./SearchDialog.css";

export interface SearchDialogProps {
  open: boolean;
  service: Pick<CollectionService, "search">;
  onClose: () => void;
  onSelect: (result: SearchResult) => Promise<void> | void;
}

/** Remains mounted in the authenticated shell so closing search keeps its place. */
export function SearchDialog({ open, service, onClose, onSelect }: SearchDialogProps) {
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
          <button type="button" aria-disabled={Boolean(selection)} onClick={close}>
            Close
          </button>
        </header>
        <label className="search-label" htmlFor={`${id}-query`}>
          Find a task, idea, or project
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
          onChange={(event) => updateQuery(event.target.value)}
          placeholder="Search your workspace"
        />
        {error && (
          <div className="search-error" role="alert">
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
                  ? "No matches. Try another word."
                  : previousResults
                    ? `Previous results for “${loadedQuery}”`
                    : `${results.length} ${results.length === 1 ? "result" : "results"}${hasMore ? " shown" : ""}`}
        </div>
        <ul className="search-results" aria-label="Search results">
          {results.map((result) => (
            <li key={`${result.recordType}:${result.recordId}`}>
              <button
                type="button"
                disabled={Boolean(selection)}
                onClick={() => void select(result)}
              >
                <span className="search-result-type">
                  {result.recordType === "todo" ? "task" : result.recordType}
                </span>
                <span className="search-result-content">
                  <strong>
                    {result.title ||
                      result.snippet.split(/\r?\n/).find((line) => line.trim()) ||
                      "Untitled"}
                  </strong>
                  {result.snippet && <span>{result.snippet}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {hasMore && !previousResults && (
          <button
            type="button"
            className="search-more"
            disabled={loading || Boolean(selection)}
            onClick={() => void fetchResults(loadedQuery, nextOffset)}
          >
            Load more
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
