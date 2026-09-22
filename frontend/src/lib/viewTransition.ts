/**
 * Whether this browser can run a view transition and the person has not asked
 * for reduced motion. Callers that animate a change as a view transition fall
 * back to applying it at once when this is false, which is also what the test
 * DOM gets.
 */
export function canRunViewTransition(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof document.startViewTransition === "function" &&
    !(
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
  );
}
