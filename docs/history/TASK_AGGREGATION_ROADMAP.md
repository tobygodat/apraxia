# Task aggregation roadmap

> Historical record, moved to `docs/history/` on 2026-09-17. File names, counts, and sizes reflect the date it was written and are not maintained.

Goal: the Tasks page (`/todos`) becomes the single list of everything with a
due date, whether it was entered on the Tasks page, inside a project, or inside
a class. Overdue work no longer has its own section; it simply shows under Today.

Status: Phases 0–3 are implemented and the coordinated hosted migration and
production deployment completed on 2026-09-14. Authenticated live persistence
and isolation checks passed. Phase 4 is deferred and requires an explicit request. See
[TASK_AGGREGATION_RELEASE.md](TASK_AGGREGATION_RELEASE.md).

## Baseline before implementation

| Source | Storage today | Appears on Tasks page? | Appears in Today? |
| --- | --- | --- | --- |
| Tasks page entries | `todos` | yes | yes |
| Project tasks (for example vidaRPM) | `todos` with `project_id` | yes, labelled with the project title | yes, labelled |
| Class assignments (for example CS 4641 Quiz 1) | `class_assignments` | no | no |

Project tasks are already unified: the project detail page creates ordinary
`todos` rows through the same composer as the Tasks page, and the board loads
every active todo. The only asymmetry is Classes.

`class_assignments` differs from `todos` in these ways:

- no due time, no `completed_at`, no `created_at`/`updated_at`, no soft delete
  or Undo token, no Today rank
- has `assignment_type` (`Homework`, `Quiz`, `Reading`, `Exam`, `Other`)
- links to `classes(user_id, id)` where the class ID is text, not UUID
- not part of global search or the Today RPC
- its own inline table editor and its own service

## Decisions

### 1. One table, not a sync

Move class assignments into `todos` instead of mirroring rows between two tables.
A mirror needs two-way writes, conflict handling, and drift repair; a single
table needs a migration and a filter. Projects already work this way.

Schema additions to `todos`:

- `class_id text` with a composite foreign key to `classes(user_id, id)`,
  `on delete set null`, indexed on `(user_id, class_id)`
- `assignment_type text not null default ''` with the same CHECK as today, and a
  CHECK that a non-empty type requires a `class_id`
- A CHECK that `project_id` and `class_id` are not both set. A task belongs to
  one place. This can be relaxed later without a data change.
- `assignment_type` stays a class-only field. It is not a general task kind.

Migration: insert every `class_assignments` row into `todos` keeping the same
UUID, `text = title`, `due_date`, `class_id = course_id`, `assignment_type`,
`completed`, and `completed_at = statement_timestamp()` for already-complete
rows (the original completion time was never recorded). `source` stays
`manual`. Then revoke browser writes on `class_assignments` and keep it as a
read-only backup until an explicit request to drop it. Hosted changes remain
forward-only, so the migration must be idempotent (`on conflict (id) do nothing`)
and the release checklist includes a backup.

### 2. Time is optional, no synthetic time

`todos.due_time` is already nullable and date-only tasks are a preserved
product rule, so assignments do not need an invented time to fit. A date-only
assignment sorts after timed tasks on the same day (the Today RPC already orders
`due_time nulls last`). Adding a default such as 11:59 PM would make a date-only
quiz look like a timed event on the Home calendar and in Today. If a default
deadline time is wanted later, it belongs on the class as a setting, not on the
task row.

### 3. Overdue becomes Today by presentation, not by rewriting dates

Decided: presentation only. An incomplete task with `due_date < today` is
shown in the Today column and the Today list. The stored date is unchanged.
The card keeps showing its original due date, and that date is rendered in red
so the slip is visible without a separate section. Tasks due today show no
date, as now.

Rewriting `due_date` at each day rollover was rejected: it needs a write on
every load or a scheduled job, races between devices, loses the original date,
and breaks Undo and the "unchanged overdue dates" rule.

Presentation keeps every existing rule in AGENTS.md and PRODUCT.md true. The
Today list already includes overdue tasks; the change is removing the Overdue
label and column and adding the red date. Ordering inside Today stays manual
rank first, then due date, then time, so older items still float up.

### 4. Tasks page shows where a task came from

Each card keeps the existing secondary line and adds a source chip: project
title, or class name plus assignment type. A filter (All, Projects, Classes,
Unassigned) sits next to the week navigation. The composer and Global Add gain
a class option next to the project option; picking one clears the other.

## Phases

Each phase ships on its own and leaves the app consistent.

### Phase 0: Overdue merges into Today (no schema change)

- `todoBoardModel.ts`: drop the `overdue` column kind; the first date column of
  the current week includes incomplete tasks due on or before today.
- `TodosBoard.tsx`: remove the Overdue column. The card's `showDueDate` path
  now applies to past-due cards inside the Today column, with a red
  `todos-board-card__due--past` style on the date text.
- `todayListModel.ts`, `TodayList.tsx`, `TodayPanel.tsx`: replace the
  `Overdue` prefix with the original due date in red, drop the `overdueCount`
  summary text, and keep the RPC's `is_overdue` flag as the signal for the red
  style (no wire contract change, so no database release for this phase).
- `ClassAssignments.tsx`: already renders past-due dates in red; keep it until
  Phase 2 replaces the table.
- Legacy `pages/Todos.tsx` and `OrbitHome.tsx` still reference Overdue; leave
  them, they are preserved legacy UI.
- Tests: board model, board, Today list, Today model; QA `realistic` and
  `dense` scenarios have overdue fixtures that move under Today.
- Docs: README Todos description, `TODAY_DATA_PROTOCOL.md` ordering note.

### Phase 1: Schema and migration

- New migration: `todos.class_id`, `todos.assignment_type`, CHECKs, index,
  column grants for `authenticated`, backfill from `class_assignments`, revoke
  insert/update on `class_assignments`.
- Today RPCs (`get_today_todos_page`, internal helper): add `class_id` and
  `class_name` to the projection and to the snapshot fingerprint.
- Search: `todos.search_vector` already indexes `text`; no change.
- Domain types, `database.ts` from the CI artifact, `Todo`/`TodayTodo` gain
  `classId`, `className`, `assignmentType`.
- pgTAP: backfill preserves IDs and completion, RLS on the new column, the
  one-parent CHECK, class deletion behaviour, and that `class_assignments` is
  no longer writable.
- Release: inspect hosted `class_assignments`, back it up, apply, verify the
  row counts match.

### Phase 2: Classes reads and writes todos

- `assignmentService.ts` becomes an adapter over `todoService`: list filters
  `class_id`, create sets `classId` and `assignmentType`, complete uses the
  existing completion path so `completed_at` stays consistent.
- The inline assignment table keeps its editor rows and pickers. The due picker
  gains an optional time (reuse the Tasks composer's time input).
- Deleting an assignment now goes through soft delete with Undo, the same as
  other tasks. Agreed as a new flow for Classes.
- `ClassesPage.test.tsx`, `assignment-service.test.ts`, QA classes fixture
  updated to the todo-backed service.

### Phase 3: Tasks page as the aggregator

- Source chip on cards, source filter, class option in `TodoComposerDialog`,
  `TodoEditDialog`, and `GlobalAddTodoController`.
- `TodoWorkspaceSnapshot` loads class summaries alongside project summaries.
- Today list shows the class chip.
- Tests for filter, chips, composer class selection, and the one-parent rule at
  the form level.

### Phase 4: Cleanup

- After live verification, an explicit request can drop `class_assignments`
  and remove the old service. Update `CLASSES_DATA_MODEL.md`, README,
  PRODUCT.md capabilities, and the AGENTS.md wording on overdue dates if the
  presentation change is adopted (the rule itself still holds).

## Resolved questions

1. Project tasks already flow through `todos`; nothing changes for projects.
2. Overdue handling is presentation only, with the original due date in red.
3. A task belongs to at most one project or class.
4. `assignment_type` stays class-only.
5. Assignments gain Undo-able deletion in Phase 2.

## Suggested order

Phase 0 first: it is self-contained, needs no database release, and shows the
new Today behaviour immediately. Phases 1 and 2 ship together as one release
because the Classes UI must switch to `todos` in the same deploy as the
migration that revokes writes on `class_assignments`. Phase 3 follows on its
own. Phase 4 waits for an explicit request.
