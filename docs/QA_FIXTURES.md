# QA fixtures

The QA fixtures are development-only Vite entry points that render the real
workspace components against in-memory services seeded with fictional data, or,
in the `personal` scenario, a private local snapshot. They exist so UI work
can be checked without an account, a database, or Google. They throw if built
outside `import.meta.env.DEV` and are excluded from the deployed bundle.

Start them with `npm run dev:web` and open
`http://localhost:5173/qa/workspace.html`.

## Entry points

| Page | Source | Parameters |
| --- | --- | --- |
| `/qa/workspace.html` | `frontend/src/qa/workspaceFixture.tsx` | `?route=`, `?scenario=`, `?drive=`, `?theme=` |
| `/qa/todos-workspace.html` | `frontend/src/qa/todosWorkspaceFixture.tsx` | `?scenario=` |
| `/qa/today-panel.html` | same file, different stage | `?scenario=` |
| `/qa/google-sign-in.html` | `frontend/src/qa/googleSignInFixture.tsx` | none |

`frontend/qa/landing-concept.html` and `frontend/qa/redesign/` are isolated
studies, not the workspace fixture.

## Parameters

**`?route=`** (workspace only) seeds the `MemoryRouter`'s initial entry, so the
fixture opens on any workspace path: `/`, `/todos`, `/projects`,
`/projects/<id>`, `/ideas`, `/classes`, `/classes/<courseId>`,
`/settings`. Navigating inside the fixture rewrites `route` in the address bar,
so a reload returns to the same page.

**`?scenario=`** selects the seed data and service behavior. The workspace
fixture defaults to `realistic`; the QA menu switches between them by reloading.

| Scenario | What it gives you |
| --- | --- |
| `personal` | A private reproduction of the real account: its tasks, projects, ideas, classes, note names, and the captured week's calendar events. Check this first, then `dense`. See [The personal snapshot](#the-personal-snapshot). Without a snapshot it shows the `realistic` seed and says so in the QA menu. |
| `realistic` | Default. Event-specific colors on one calendar, three-way overlaps, adjacent 15-minute events, 5 to 120-minute events, long and untitled events, multiple all-day lanes, midnight crossings, hidden and read-only calendars. |
| `calendar` | Calendar-focused week seed. |
| `typical` | A quiet week. |
| `empty` | No tasks, collections, events, classes, or page name. |
| `dense` | Crowded week (eight events per day) plus long text. |
| `long` | Long titles and descriptions without the crowded week. |
| `slow` | Every service call delayed 1.5 s instead of the usual 180 ms. |
| `error` | Calendar, tasks, and collection services reject, so error and retry states render. |
| `disconnected` | Calendar reports no connection. |

The standalone Todo fixtures accept `default`, `empty`, `dense`, and `error`.

**`?theme=`** (workspace only) seeds the device theme preset before the
workspace mounts: `classic` (the default), `paper`, or `paper-light`. It writes
the same `apraxia:workspace-preferences` entry Settings writes, so the choice
survives a reload until another `?theme=` replaces it.

**`?drive=`** (workspace only) sets the Drive fixture state:
`?drive=disconnected` reports no Drive connection, `?drive=error` makes file
listing fail. Omit it for a connected Drive. Pair it with
`?route=/classes/math3012`.

## The personal snapshot

`npm run qa:snapshot` reads the account through the
[personal agent API](AGENT_API.md) with GET requests only and writes
`frontend/qa/local/workspace-snapshot.json`. It takes `APRAXIA_BASE_URL` and
`APRAXIA_AGENT_TOKEN` from the environment or `.env.muse.local`. Run it again
whenever the fixture should catch up with the account.

The folder is gitignored. The file is personal data: never commit it, and treat
screenshots of the `personal` scenario the same way. It leaves out the token,
owner id, Drive file ids, event locations, and Google event URLs. Note PDFs are
not captured, so opening a note behaves as in the other scenarios.

`qa/personalSnapshot.ts` loads the file through `import.meta.glob`, so a checkout
without it still builds. On load every task date moves forward by whole weeks,
so the captured week is always the week on screen: what was due Thursday is
still due Thursday and what had slipped has still slipped. The captured week's
events replay in every calendar week, on the fixture's own calendars with their
real colors. Edits behave as in any scenario and never reach the account.

## What persists

Calendar edits, visibility, and page appearance are written to `sessionStorage`
under `apraxia:qa:workspace:v3:<scenario>:<local date>`, so reload checks are
meaningful and each scenario, day, and tab stays isolated. **Reset calendar and
page name** in the QA menu clears those keys. Tasks and collections are in-memory
and reset on reload. Classes, notes, and assignments persist across navigation
and reset on reload. Nothing is written to account storage.

## How a fixture service maps to the real one

`WorkspaceRuntime` takes its services as props, so the fixture and the
authenticated app differ only in which implementation is passed in. Pages,
navigation cache, preload, and invalidation are the same code.

| Prop | Real implementation | Fixture |
| --- | --- | --- |
| `todoService` | `features/todos/supabaseTodoService.ts` | inline object in `workspaceFixture.tsx` |
| `collectionService` | `features/collections/collectionService.ts` | inline object in `workspaceFixture.tsx` |
| `calendarService` | `features/calendar/calendarService.ts` (via `/api/calendar`) | `qa/workspaceFixtureCalendar.ts`, using the production event normalizer |
| `driveService` | `features/classes/driveService.ts` (via `/api/drive`) | inline object, including a Picker stub |
| `workspaceData.classes` / `.notes` | `features/classes/classService.ts`, `noteService.ts` | `qa/classPersistenceFixture.ts` |
| `workspaceData.assignments` | `features/classes/assignmentService.ts` | `qa/ClassAssignmentsMock.tsx` |
| `workspaceData.homeAppearance` | `features/calendar/homeAppearance.ts` | `createFixtureAppearance` in `qa/workspaceFixtureSupport.ts` |
| `workspaceData.profile` / `.projects` | `apps/workspaceData.ts` | inline fictional profile and project list |

Every fixture service is wrapped in `delayedFixtureService`, which adds the
scenario's latency so loading states are visible.

One seeded task repeats weekly, so the Repeats control, the row's repeat marker
and the loop around them can all be inspected: completing it produces the next
occurrence and undoing that takes the occurrence away again. The Tasks fixture
steps from the occurrence in hand rather than from where the series started,
which the database does, so it demonstrates the flow without standing in for the
trigger. What the database actually does is covered by
`tests/contract/recurring-todos.test.ts` and
`supabase/tests/160_recurring_todos.test.sql`.

## Adding a scenario

1. Add the name to the scenario list in the `FixtureTools` menu in
   `frontend/src/qa/workspaceFixture.tsx`.
2. Branch on it where the seed data is built. Most scenarios only need to appear
   in one or two places: the `empty` / `long` flags near the top, the
   `pageTitle` seed, the `delay` constant, or `createFixtureCalendar` in
   `frontend/src/qa/workspaceFixtureCalendar.ts`.
3. Keep every identity, title, and address fictional, and keep `.invalid`
   domains. No real data or credentials belong in a fixture.
4. If the scenario changes calendar seeding, extend
   `frontend/src/qa/workspaceFixtureCalendar.test.ts`.
5. Document the scenario in the table above.

## What fixtures cannot prove

Fixtures never touch Supabase, Google, or the network. They cannot establish:

- database persistence, RLS, or that a migration was applied,
- Google OAuth, consent, scopes, permissions, or the real Picker popup,
- calendar recurrence expansion, notifications, or provider write behavior,
- hosted environment configuration, CSP, API-key restrictions, or streaming,
- anything about the deployed bundle.

For data-dependent or provider-dependent changes, also check the authenticated
app before release: see
[pre-deployment UI checks](CLOUD_DEVELOPMENT.md#pre-deployment-ui-checks).
