---
version: 1
slug: "src-features-todos-todosboard-tsx"
primary_target: "src/features/todos/TodosBoard.tsx"
related_targets: ["src/features/todos/TodosBoard.css"]
---

# Tasks page (/todos) surface brief

Scope: the Tasks board at `/todos`, rendered by `frontend/src/features/todos/TodosBoard.tsx` and `TodosBoard.css`. Mode: Operate. The visitor scans the week, sees today at a glance, ticks tasks off, and adds tasks to a day or to Inbox.

Audience and job: the owner planning a week on a desktop; friends later. Content: date columns from `buildTodoBoardModel` (current week starts at today; other weeks show Mon–Sun), plus the Inbox column (no due date). Constraints: date-only due dates, past-due tasks stay under Today with their original date visible, completed historical tasks stay in their own day; all task controls keep their accessible names, focus recovery, and Undo behaviour.

Unresolved: whether Inbox should be renamed "Someday" (copy change, not made without approval); whether the today accent should stay periwinkle or become a neutral brightness step.

## Direction contract

THESIS: The week is a ruled ledger, not a kanban. One idea: a big date with its weekday beside it, a rule under each day, and thin hairline rows that keep ruling even where nothing is written. It refuses bordered 240px columns behind a horizontal scrollbar.

OWN-WORLD: Charcoal canvas (#191919), warm paper text (#f0efed), warm grey (#ada9a3) and faint white for secondary marks. Hairline rules at rgba(255,255,255,0.12); a 2px rule under each day header. Dates in Space Grotesk 500 at 22px with tabular numerals, weekday in the same face at 400, faint. Today, and only today, takes the single accent `--todos-board-today: #8b9bff` on its date and rule. Rows are flat; hover raises to #262626; add-slot hover raises to #2b2b2b. Page title stays the shared Georgia treatment. No cards, no column borders, no boxed counts.

STORY: The visitor reads the week left to right like a planner spread, finds today by its lit header, sees which days are heavy by how far their ink runs down the ruled lines, and understands Inbox as the unscheduled band beneath. Ticking a task strikes it; hovering an empty slot invites a new one.

FIRST VIEWPORT: Toolbar as today (Tasks title, week range, Source, prev/Today/next). Below it, date columns fill the full content width in equal tracks with 28px gutters and no horizontal scroll. When seven dates are visible, Saturday and Sunday share the last track, Sunday stacked under Saturday with its own header. Each header: date left, weekday right, baseline-aligned, 2px rule beneath. Tasks as single-line 40px rows with hairline undersides, checkbox faint until hover, edit/delete revealed on hover or focus; then an add slot (label appears on hover/focus), then inert ruled slots so every full column reaches nine rows and each stacked one reaches four. Beneath the week, an Inbox band: Georgia heading at 26px on the left, its tasks in ruled rows flowing across auto-fill columns of at least 220px, at least two ruled rows deep.

FORM: Week ledger, candidate 1 on the ordered list, brief-pinned by the user's screenshot; the roll (seed 3fd15fc8, dealt 7, 2, 3) was presented and superseded by the pinned brief after no answer arrived. Signature interaction: changing weeks slides the ledger 8px with an exponential ease-out fade over 220ms, keyed on the visible Monday; reduced motion disables it. Motion grammar: transitions only on hover raise, action reveal, and the week change.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
