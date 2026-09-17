import { registerUserStateResetter } from "../../auth/userState";

// Decoded cover dimensions, keyed by image src, so a revisit to an
// already-seen cover has geometry ready on the very first layout pass
// instead of waiting ~50ms for the <img> to decode again. Data-URI keys can
// be up to ~350KB each, so this is capped with simple FIFO eviction and
// cleared entirely at the account boundary.
//
// Kept apart from HomeHeader so the startup preload in WorkspaceRuntime can
// prime a cover without pulling the header component into the eager chunk.
const DECODED_COVER_SIZE_LIMIT = 4;
// Exported only for the eviction test.
export const decodedCoverSize = new Map<string, { width: number; height: number }>();

export function rememberCoverSize(src: string, size: { width: number; height: number }): void {
  decodedCoverSize.delete(src);
  decodedCoverSize.set(src, size);
  while (decodedCoverSize.size > DECODED_COVER_SIZE_LIMIT) {
    const oldest = decodedCoverSize.keys().next().value;
    if (oldest === undefined) break;
    decodedCoverSize.delete(oldest);
  }
}

registerUserStateResetter(() => decodedCoverSize.clear());

/**
 * Decodes a cover image ahead of the header ever mounting it, so a startup
 * preload can populate `decodedCoverSize` before the first paint of Home.
 * Guarded for non-browser environments (SSR/tests without a DOM `Image`).
 */
export function primeCoverImage(src: string): void {
  if (typeof Image === "undefined" || decodedCoverSize.has(src)) return;
  const image = new Image();
  image.onload = () => {
    rememberCoverSize(src, { width: image.naturalWidth, height: image.naturalHeight });
  };
  image.src = src;
}
