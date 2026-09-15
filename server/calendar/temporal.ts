type TemporalApi = (typeof import("@js-temporal/polyfill"))["Temporal"];

let polyfill: TemporalApi | null = null;

/**
 * The polyfill is roughly 3 MB resident, so no calendar function pays for it at
 * module load. Request paths that do civil-time arithmetic await this once and
 * then use `requireTemporal()` from the synchronous validators below them.
 */
export async function loadTemporal(): Promise<TemporalApi> {
  polyfill ??= (await import("@js-temporal/polyfill")).Temporal;
  return polyfill;
}

/** Only reachable from code the handler already awaited `loadTemporal()` for. */
export function requireTemporal(): TemporalApi {
  if (polyfill === null) {
    throw new Error("Calendar time arithmetic ran before the polyfill was loaded.");
  }
  return polyfill;
}
