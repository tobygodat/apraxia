# Interview preparation and daily tasks

Career preparation uses the same tasks as Home and the Tasks board. Complete,
reschedule, or remove an action from either place and its other view follows.
Undated actions appear in Inbox; actions due today or earlier appear on Home.
Future actions appear on their date in Tasks. Original deadlines stay unchanged.
The Tasks board currently groups Career actions under the **personal** filter;
the application link is visible in Career.

## Use a plan from your assistant

1. Open **career**, select an application, then open **prep**.
2. Choose **brief for AI**. Select relevant behavioral stories and projects;
   optionally leave out process notes, saved questions, or existing preparation.
3. Choose **review brief**. Edit the text, then **copy brief** and paste it into
   your assistant. Apraxia does not send it to a model automatically.
4. Bring the answer back with **import a plan**. Paste a plain list, a Markdown
   checklist, or the JSON requested by the brief.
5. Choose **review tasks**. Edit text and dates, select which actions to keep,
   then save. Nothing is created before this final save.

The brief identifies the application and selected records, distinguishes known
dates from missing dates, and includes existing completion state. Project
descriptions are fetched only for selected projects. It does not read PDFs,
fetch the posting URL, or send unrelated account records to an assistant.

The supported JSON format is:

```json
{
  "tasks": [
    { "text": "Practice the project introduction", "due_date": "2026-09-25" },
    { "text": "Choose a teamwork example", "due_date": null }
  ]
}
```

The JSON can arrive inside a reply with other text: paste the whole reply and
the one JSON block in it is read. Imports accept at most 50 tasks, with up to
2,000 characters of text per task.
Plain lists do not infer dates from prose. Invalid JSON or impossible dates
produce an error before saving. Exact matches to existing preparation are left
unselected in the review; users can still choose them deliberately.

## Retry and recovery

A reviewed import keeps stable item IDs. The batch is one database operation,
so a failed item does not leave a partially imported plan. After an uncertain
response, retrying the same plan returns the already-saved tasks without
overwriting edits made elsewhere; a task deleted since the first save stays
deleted and is left out. Imports into one application run one at a time, so a
retry sent while the first request is still running waits for it and replays.
The reviewed payload is kept unchanged for retry, including when the import
panel is closed and reopened on the same page. When the save is rejected
outright (the application is gone, a text or date is invalid, or the IDs clash
with other records), nothing was saved and the review becomes editable again.
Navigating away discards that in-memory review; check saved preparation before
starting a new import.

The application continues to work without an assistant: add a prep item directly,
or manage its action through Tasks. Removing an application removes its linked
actions from daily views. Restoring the application restores only actions removed
by that same application deletion; independently removed actions stay removed.
While the application is deleted, undoing an action's own removal in Tasks
restores nothing; restore the application first. A repeating action keeps its
application: completing an occurrence adds the next occurrence to Career as its
own prep item, and undoing the completion removes it again.

## Data contract

`career_prep.todo_id` identifies the canonical todo. The todo owns text, due date,
completion, and soft deletion; Career owns application membership and ordering.
The prep fields are a database-maintained projection, not an independently
writable task store. Browser writes use authenticated RPCs under RLS.

The forward migration
`20260922062559_canonical_career_prep_todos.sql` links existing isolated prep to
tasks and preserves existing linked todos as authoritative. It rejects an
ambiguous legacy case where multiple prep rows link to one todo. Hosted rollout
requires the normal data inspection and backup; implementing this feature does
not apply that migration to the hosted app.

Per-account assistant OAuth, direct Career MCP tools, hosted model inference,
PDF extraction, and configurable page sections remain later stages from the
[consumer research](CONSUMER_PRODUCT_RESEARCH_2026-09-22.md).
