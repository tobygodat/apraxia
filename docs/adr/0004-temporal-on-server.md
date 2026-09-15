# 0004. Calendar time arithmetic on the server, with Temporal

Status: accepted. Date: 2026-09-04.

## Context

The calendar runs Sunday through Saturday in the profile's timezone. Computing a
week window means civil dates plus named timezones plus DST, and the fetch
bounds must cover both the profile's week and each source calendar's week so no
event is dropped at a date line. All-day ends are exclusive Google dates, and
skipped or ambiguous local times must be rejected rather than guessed.

JavaScript `Date` cannot express any of that safely. It also cannot be trusted
across browsers and devices, and the browser clock is not authoritative for
"today" in the first place.

## Decision

Week bounds, event normalization, and the write-side time validation run on the
server, using the `@js-temporal/polyfill` package.

- `server/calendar/weekWindow.ts` derives the inclusive Sunday-to-Saturday range
  from a civil date and a named timezone. `server/calendar/temporal.ts` owns the
  single lazy import of the polyfill: the handler awaits `loadTemporal()` on the
  paths that need it and the synchronous validators below it call
  `requireTemporal()`.
- `server/calendar/normalizeGoogleEvent.ts` produces the browser projection; it is
  also the browser's normalizer, so it keeps a direct import and `loadCalendarWeek`
  imports the module dynamically. `shared/calendarEventContract.ts` holds the
  shapes both sides agree on and validates them by hand: civil dates compare as
  strings, instants as epoch nanoseconds, and time zones through `Intl`. It needs
  neither Temporal nor a schema library, so the editor chunk carries neither.
- The browser receives `WeekViewModel` with the range and RFC 3339 timestamps
  already resolved. Client-side Temporal use is confined to the calendar feature
  (`eventLayout.ts`, `eventInput.ts`, `EventPreview.tsx`, `HomePage.tsx`) for
  grid placement and editor validation.
- Todo due dates are unrelated to this: they are date-only strings handled by
  string helpers, never by `Date` or Temporal.

## Consequences

- One implementation of the hard cases, covered by contract tests that do not
  need a browser.
- The polyfill is roughly 129 kB and about 3 MB resident in the Vercel function.
  Nothing in the calendar function's static import graph loads it any more: the
  week-read path loads it once per cold start, and connect, callback, complete,
  status, disconnect, calendars, and event writes never do. A malformed
  `sunday` is rejected by `assertCalendarWeekSunday`, a pure civil-date check, before
  any load. Lazy-loading calendar in the client remains an open follow-up.
- `googleCalendarTransport.ts` validates zones with `Intl` and orders its two
  request bounds with `Date`; both inputs are already regex-constrained RFC 3339,
  so no polyfill is warranted there.
- Any new time arithmetic belongs on the server or in a shared pure helper, not
  inline in a component.

Details: [Calendar](../CALENDAR.md).
