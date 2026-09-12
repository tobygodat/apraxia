import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { DeleteUndoToken, UUID } from "../types/domain";

export type DeletionKind = "todo" | "project" | "idea" | "media";
export interface DeletionRecord {
  readonly key: string;
  readonly kind: DeletionKind;
  readonly id: UUID;
  readonly label: string;
  readonly token: DeleteUndoToken;
  readonly pending: boolean;
  readonly error: string | null;
}
interface InternalRecord extends DeletionRecord {
  readonly restore: () => Promise<boolean>;
}
export interface DeletionStore {
  readonly entries: readonly DeletionRecord[];
  add(record: Omit<DeletionRecord, "key" | "pending" | "error">, restore: () => Promise<boolean>): void;
  undo(key: string): Promise<void>;
  dismiss(key: string): void;
  clear(): void;
  subscribe(listener: () => void): () => void;
}

class SessionDeletionStore implements DeletionStore {
  private records = new Map<string, InternalRecord>();
  private snapshot: readonly DeletionRecord[] = [];
  private listeners = new Set<() => void>();
  private locks = new Set<string>();
  get entries(): readonly DeletionRecord[] { return this.snapshot; }
  private emit() {
    this.snapshot = [...this.records.values()];
    for (const listener of this.listeners) listener();
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  add(record: Omit<DeletionRecord, "key" | "pending" | "error">, restore: () => Promise<boolean>) {
    const key = `${record.kind}:${record.id}`;
    this.records.set(key, { ...record, key, pending: false, error: null, restore });
    this.emit();
  }
  async undo(key: string) {
    const current = this.records.get(key);
    if (!current || this.locks.has(key)) return;
    this.locks.add(key);
    this.records.set(key, { ...current, pending: true, error: null }); this.emit();
    try {
      if (await current.restore()) this.records.delete(key);
      else this.records.set(key, { ...current, pending: false, error: "Undo is no longer available. Try again." });
    } catch {
      this.records.set(key, { ...current, pending: false, error: "The record could not be restored. Try again." });
    } finally { this.locks.delete(key); this.emit(); }
  }
  dismiss(key: string) { if (this.locks.has(key)) return; this.records.delete(key); this.emit(); }
  clear() { this.records.clear(); this.locks.clear(); this.emit(); }
}

export function createDeletionStore(): DeletionStore {
  return new SessionDeletionStore();
}

const DeletionContext = createContext<DeletionStore | null>(null);
export function DeletionStoreProvider({ children }: { readonly children: ReactNode }) {
  const store = useMemo(createDeletionStore, []);
  return <DeletionContext.Provider value={store}>{children}<DeletionTray store={store} /></DeletionContext.Provider>;
}
export function useDeletionStore(): DeletionStore | null { return useContext(DeletionContext); }

function DeletionTray({ store }: { readonly store: DeletionStore }) {
  const entries = useSyncExternalStore(store.subscribe, () => store.entries, () => []);
  if (!entries.length) return null;
  return <aside className="deletion-tray" aria-label="Deleted records">
    <details open>
      <summary>Deleted ({entries.length})</summary>
      <ul>{entries.map(entry => <li key={entry.key}>
        <span>{entry.label}</span>
        {entry.error ? <span role="alert">{entry.error}</span> : null}
        <button type="button" disabled={entry.pending} onClick={() => void store.undo(entry.key)}>{entry.pending ? "Restoring…" : "Undo"}</button>
        <button type="button" disabled={entry.pending} onClick={() => store.dismiss(entry.key)}>Dismiss</button>
      </li>)}</ul>
    </details>
  </aside>;
}
