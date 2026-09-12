import type { DeleteUndoToken, UUID } from "../types/domain";

/**
 * Draft metadata is intentionally kept out of the editable JSON shape. This
 * keeps provider-facing contracts small while allowing a form to reuse one ID
 * and one exact version across retries.
 */
const metadata = new WeakMap<object, { id?: UUID; expectedUpdatedAt?: string }>();

export function newDraftId(): UUID {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}

export function withDraftId<T extends object>(value: T, id: UUID): T {
  const current = metadata.get(value) ?? {};
  metadata.set(value, { ...current, id });
  return value;
}

export function draftId(value: object): UUID | undefined { return metadata.get(value)?.id; }

export function withExpectedUpdatedAt<T extends object>(value: T, expectedUpdatedAt: string): T {
  const current = metadata.get(value) ?? {};
  metadata.set(value, { ...current, expectedUpdatedAt });
  return value;
}

export function expectedUpdatedAt(value: object): string | undefined {
  return metadata.get(value)?.expectedUpdatedAt;
}

export interface DeletionEntry {
  readonly key: string;
  readonly kind: "todo" | "project" | "idea" | "media";
  readonly id: UUID;
  readonly label: string;
  readonly token: DeleteUndoToken;
  readonly pending: boolean;
  readonly error: string | null;
}
