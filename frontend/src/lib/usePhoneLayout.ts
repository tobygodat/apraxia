import { useMediaQuery } from "./useMediaQuery";

/**
 * The width at or below which the workspace lays itself out for a phone. It is
 * the breakpoint the shell and the Tasks board already use, so one query
 * describes "this is a phone" for layout that has to be decided in JavaScript
 * rather than in CSS — where the reading order, not just the painting order,
 * has to change.
 */
export const PHONE_LAYOUT_QUERY = "(max-width: 620px)";

/** True while the viewport is phone-width; false where `matchMedia` is unavailable. */
export function usePhoneLayout(): boolean {
  return useMediaQuery(PHONE_LAYOUT_QUERY);
}
