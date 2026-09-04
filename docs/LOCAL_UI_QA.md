# Local UI verification

The provider-injected Phase 2 workspace can be inspected without the blocked
Supabase setup:

```powershell
npm run dev:web
```

Open `http://localhost:5173/qa/todos-workspace.html`. This separate development
entry uses fictional in-memory data. It reads no account credentials and is
not imported by the production app. Reloading resets its records.

`http://localhost:5173/qa/today-panel.html` uses the same fictional service for
the reusable Today panel, without a Calendar or authenticated account. The
banner links between both previews and their scenarios.

## Fixtures

- Default: Inbox, overdue tasks with original dates, current-week tasks, times,
  project labels, and empty date columns.
- `?scenario=empty`: empty board and contextual/global Add.
- `?scenario=dense`: 108 tasks, including 102 overdue tasks and long text.
- `?scenario=error`: first workspace load fails; Try again succeeds.
- Today default: four eligible tasks; dense: 104 eligible tasks, including 102
  overdue. Undo reloads the shared in-memory store; reordering changes its ranks.

## Checked on 2026-09-03

- Default live preview rendered in the Codex sidebar; a separate background
  browser tab was used for mutations and layout checks.
- At 1280×720, global Add opened with focus on Task. Shift+Tab wrapped to Add
  todo; saving updated Inbox and returned focus to the global Add control.
- The edit form rendered initial values and retained keyboard access to its
  controls at 640×360, the CSS viewport equivalent of 200% zoom on 1280×720.
  This is not a substitute for a final real-browser 200% zoom acceptance pass.
- The reduced-viewport edit dialog stayed inside the viewport and scrolled its
  contents; Shift+Tab brought Save changes into view.
- All 108 dense-fixture tasks remained in the DOM; 102 were in Overdue.
- Dense boards keep a bounded scroll region and sticky column headings, so
  the horizontal scrollbar stays reachable without scrolling through every
  overdue row. At 1280×720 it remained inside the visible viewport.
- A browser check exposed page-level overflow from offscreen accessibility
  labels. The board now contains positioned children and owns its horizontal
  overflow; the document no longer grows wider than the viewport.
- Browser console showed no warning/error entries during these checks.
- Today at 1280×720: all 104 dense rows were retained in a separately scrolling
  list, with no document-width overflow. After deletion, the Undo footer stayed
  below that scroll region and inside the viewport. Undo restored the row and
  focused its completion checkbox.
- Native keyboard date editing in the reschedule form moved a task to a future
  date, removed it from Today, and returned focus to the panel when its opener
  disappeared. The browser automation's date `fill` operation changed the DOM
  value without updating React's draft in this environment; native keyboard
  input was used for the actual interaction check.
- At 640×360, the reschedule dialog stayed within the viewport and its own
  content scrolled. Shift+Tab from Due date focused Save changes and scrolled
  it fully into view. The temporary viewport override was reset afterward;
  this is still not a true 200% browser-zoom acceptance pass.
- The Today error scenario exposed a React StrictMode startup timing race:
  a layout-started read could consume the deliberate error before effect
  replay. Startup now uses a passive effect while account cleanup remains in
  layout. A concurrent-root regression reproduces the old failure; the browser
  now shows the error, Try again loads all four rows, and Empty shows Add a task.
- Changing hook structure during live development produced a transient Fast
  Refresh hook-order error in the old QA tab. A clean-load confirmation after
  the update rendered correctly, retried successfully, and logged no warnings
  or errors. No user preview was reloaded for this check.

## Google sign-in control, checked on 2026-09-03

`http://localhost:5173/qa/google-sign-in.html` injects a fake signed-out Auth
client and a delayed failure into the real cloud auth frame. The banner states
that no Google page or real account is opened. This is a separate development
entry, excluded from deployment, with no credentials or network calls.

- At the default 1265×712 viewport, the existing auth layout rendered the
  Google action and separate Calendar-consent explanation without clipping.
- Activating Continue with Google disabled the control, changed its label to
  Opening Google, and exposed a live status. The simulated failure restored
  the control and displayed a fixed, credential-free error message.
- Shift+Tab returned focus to the action with a visible outline. Enter retried
  the action, removed the old error, and showed the pending state again.
- At 640×360, a reduced desktop viewport used as a 200%-zoom layout equivalent,
  the page remained vertically scrollable and its error/note stayed reachable.
  Document and viewport widths both measured 625 pixels excluding the scrollbar;
  no page-width overflow was present. This is not actual browser-zoom acceptance.
- Browser logs contained no warning/error entries. Temporary viewport settings
  were reset and the separate test tab was closed; user preview tabs were not
  reloaded or closed. The scoped interface detector reported no findings.

The flow's SDK URL/PKCE, duplicate attempt, timeout, cancellation, unmount,
browser Back, and stale-result checks are automated separately. No real Google
login, Supabase provider, session callback, or provider-token storage check
was performed in this fixture.

## Still required before phase completion

- Repeat these flows against the generated-type Supabase adapter, not fixtures.
- Verify actual 200% browser zoom, keyboard-only end-to-end flows, and assistive
  technology behavior with authenticated data.
- Complete local Supabase, pgTAP, committed migration rewind/reapply, Preview,
  and Auth checks recorded in `USER_ACTIONS.md`.
- Verify persisted Today order across a real reload and Calendar-independent
  Today loading once the Home integration is implemented.
