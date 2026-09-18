/**
 * The Drive folder a class was last opened from, kept per class so the picker
 * reopens where the notes live instead of at the top of My Drive.
 *
 * This is a per-device convenience, so it lives in localStorage rather than in
 * Postgres: losing it costs one extra click, and it carries no personal data
 * beyond a folder id the account can already see.
 */

/** Google's own file and folder id shape, matched before it reaches the picker. */
export const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

const KEY_PREFIX = "apraxia:drive-folder:v1";

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    // Private browsing and blocked site data both throw on first access.
    return null;
  }
}

function key(userId: string, courseId: string): string {
  return `${KEY_PREFIX}:${userId}:${courseId}`;
}

export function readDriveFolder(userId: string, courseId: string): string | undefined {
  try {
    const saved = storage()?.getItem(key(userId, courseId));
    return saved && DRIVE_ID_PATTERN.test(saved) ? saved : undefined;
  } catch {
    return undefined;
  }
}

/** A null parent clears the memory, so a file picked from My Drive resets it. */
export function rememberDriveFolder(
  userId: string,
  courseId: string,
  parentId: string | null | undefined,
): void {
  const store = storage();
  if (!store) return;
  try {
    if (parentId && DRIVE_ID_PATTERN.test(parentId)) store.setItem(key(userId, courseId), parentId);
    else store.removeItem(key(userId, courseId));
  } catch {
    /* A full or blocked store only costs the shortcut. */
  }
}
