# QA fixtures

The QA fixtures are development-only Vite entry points that render the real
workspace components against in-memory fictional services. They exist so UI work
can be checked without an account, a database, or Google. They throw if built
outside `import.meta.env.DEV` and are excluded from the deployed bundle.

Start them with `npm run dev:web` and open
`http://localhost:5173/qa/workspace.html`.

## Entry points

| Page | Source | Parameters |
| --- | --- | --- |
| `/qa/workspace.html` | `frontend/src/qa/workspaceFixture.tsx` | `?route=`, `?scenario=`, `?drive=` |
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
| `realistic` | Default. A saved cover with an off-center crop, event-specific colors on one calendar, three-way overlaps, adjacent 15-minute events, 5 to 120-minute events, long and untitled events, multiple all-day lanes, midnight crossings, hidden and read-only calendars. |
| `calendar` | Calendar-focused week seed. |
| `typical` | No cover. Use this for the no-cover layout check. |
| `empty` | No tasks, collections, events, classes, or cover. |
| `dense` | Crowded week (eight events per day) plus long text. |
| `long` | Long titles and descriptions without the crowded week. |
| `portrait` | Portrait-aspect cover. |
| `slow` | Every service call delayed 1.5 s instead of the usual 180 ms. |
| `error` | Calendar, tasks, and collection services reject, so error and retry states render. |
| `disconnected` | Calendar reports no connection. |

The standalone Todo fixtures accept `default`, `empty`, `dense`, and `error`.

**`?drive=`** (workspace only) sets the Drive fixture state:
`?drive=disconnected` reports no Drive connection, `?drive=error` makes file
listing fail. Omit it for a connected Drive. Pair it with
`?route=/classes/math3012`.

## What persists

Calendar edits, visibility, and page appearance are written to `sessionStorage`
under `orbitos:qa:workspace:v3:<scenario>:<local date>`, so reload checks are
meaningful and each scenario, day, and tab stays isolated. **Reset calendar and
cover** in the QA menu clears those keys. Tasks and collections are in-memory
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

## Adding a scenario

1. Add the name to the scenario list in the `FixtureTools` menu in
   `frontend/src/qa/workspaceFixture.tsx`.
2. Branch on it where the seed data is built. Most scenarios only need to appear
   in one or two places: the `empty` / `long` flags near the top, the `cover`
   list, the `delay` constant, or `createFixtureCalendar` in
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
