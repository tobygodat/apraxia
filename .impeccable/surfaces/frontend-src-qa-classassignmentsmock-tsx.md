---
version: 1
slug: "frontend-src-qa-classassignmentsmock-tsx"
primary_target: "frontend/src/qa/ClassAssignmentsMock.tsx"
related_targets: ["frontend/src/qa/classAssignmentsMock.css", "frontend/src/qa/AssignmentDatePicker.tsx", "frontend/src/qa/assignmentDatePicker.css", "frontend/src/qa/AssignmentTypePicker.tsx", "frontend/src/qa/assignmentTypePicker.css", "frontend/src/features/classes/ClassesPage.tsx"]
---

# Class assignments and notes

Accepted design, finalized 2026-09-13. Mode: Operate.

## Scope

This is a code-first design prototype inside the existing local QA workspace.
The preview route is `/qa/workspace.html?scenario=realistic&route=%2Fclasses%2Fmath3012`,
served on port 5299 during this design session. Use the same route on the active
Vite port in a new session. The user's preferred browser is Chrome.

Assignment data is fictional, held in component state, and resets on reload or
class navigation. The authenticated app does not render this prototype unless
the optional assignment content is explicitly supplied. Persistence, database
schema, and production release are separate implementation work.

## Layout and visual contract

- Keep the class heading and All classes navigation at the module's usual left edge.
- Show assignments first; center only the assignment database and Notes content
  within a 940px maximum width.
- Use Done, Name, Date, and Type columns with subtle row and column dividers.
  Display the Done heading accessibly rather than as visible text.
- Use regular-weight names, literal month-and-day dates such as Sep 13, and one
  neutral type-label style. Preserve the full date value internally and the year
  in the calendar's month heading.
- Keep rows compact. Type labels retain their size and position when activated.
- Use the existing charcoal surfaces, warm light text, quiet outlined Add action,
  and restrained hover/focus treatments. Do not add Unfinished/All tabs, extra
  database columns, or colorful type categories.
- On narrow screens, contain horizontal scrolling within the table. Popovers
  escape that container and stay inside the viewport; touch options are at least
  44px tall.

## Interaction contract

- Add assignment inserts a single blank draft above the first row. Clicking away
  discards a completely empty draft; otherwise a name is required before saving.
- Clicking a name edits it inline. Enter or leaving the row commits; Escape
  restores the original row or discards a new draft. Keep validation beside Name.
- Clicking Date immediately opens the styled calendar. Choosing a day or clearing
  the date applies it directly on an existing row. Escape dismisses the calendar
  without changing its value. Keep keyboard navigation and focus restoration.
- Clicking Type immediately opens the styled list, without entering whole-row
  editing. Choices are Homework, Quiz, Reading, Exam, Other, and None. Selecting
  one applies it and closes the list. Support arrows, typeahead, Enter/Space,
  Escape, outside dismissal, and Tab onward.
- Date and Type choices in a draft remain part of that draft until the row is
  committed. Opening or dismissing either picker must not discard the draft.
- Do not show check/X confirmation controls. Keep completion checkboxes and Undo.
- Sort open assignments before completed ones, then by date with undated work
  last. Keep an active name/draft row in place until commit and preserve focus
  when a saved date changes its row's position.

## Notes

Keep the source controls compact until a PDF opens. Offer Open from Drive and
From device through existing controls, then show the existing reader and toolbar.
Switching to the local source cancels a pending Drive selection. Mockup checks
use fictional provider responses and do not establish real Google connectivity.

## Verification

The finalized prototype passed 1,952 tests, server/frontend type checks, the
production build, and the browser bundle check. The test suite used four workers
to avoid local filesystem-scan timeouts. Chrome checks covered desktop and touch
layouts, stable label geometry, first-click pickers, keyboard interaction,
validation, draft recovery, sorting/focus, and fixture PDF opening. The calendar
was also checked after reload in dense, portrait-cover, and typical scenarios.

The historical critique remains closed as a record of the earlier design; its
score describes that earlier version, not this accepted result.
