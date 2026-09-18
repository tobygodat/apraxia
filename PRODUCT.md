# apraxia

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Currently a personal workspace for its owner. The owner plans to give friends
access so they can use apraxia for their own information and workflows.
Friends' access is a future product direction, not a claim of launch readiness.

## Product Purpose

Reduce the mental overhead of capturing, organizing, and acting on everyday
information. Tasks, projects, ideas, and class notes belong in one
desktop-first workspace, with Calendar and Today supporting daily planning.
Additional modules are planned; their scope remains undecided.

## Operating Context

The workspace favors manual capture and explicit user control. Home brings
Google Calendar and Today together; other modules support organizing and
retrieving information beyond the current day.

Develop locally and release to the existing Vercel/Supabase app. The cloud
implementation uses React/Vite, Supabase authentication and database access,
and server-side endpoints. Repository workflow and security rules live in
AGENTS.md.

## Capabilities and Constraints

- Existing workspace areas are Todos, Projects, Ideas, Calendar, and Classes
  with assignments and course notes.
- Classes supports saved notes, device PDF uploads, and Google Drive notes
  through Google's native Picker, with a separate Drive consent. No background
  Drive synchronization or Drive writes exist. See docs/DRIVE.md.
- Keep each person's information private to their account. Browser data access
  uses authenticated sessions and row-level security; provider credentials
  remain server-only.
- Preserve date-only due dates, unchanged overdue dates, atomic Today ordering,
  and recoverable actions.
- Visual theme is a device-local preference, not an account setting; classic is
  the default. Changing it never changes what a screen can do.
- Preserve legacy source and data. Hosted schema changes are forward-only.
- New modules and broader access require scoped implementation decisions;
  neither is authorization to add unspecified features now.

## Brand Commitments

The product name is apraxia, lowercase. It is one of several things built on
the Toby Godat design system, and it takes that system whole rather than
keeping a look of its own: warm paper in two themes, Literata throughout, one
green that only ever means "here", rules instead of boxes, and a word wherever
another product would put a button. DESIGN.md records how apraxia applies it
and is binding for every new surface and every change to an existing one.

Voice follows from the same place. Interface words are lowercase; user content
and proper nouns keep their own case. Items on a line are joined with a spaced
middle dot. Facts are stated with their numbers rather than with adjectives.
Errors say what happened and what to do, in a sentence, without blame. Section
headings carry a green `// ` prefix, the only nod to code. No emoji.

The workspace still ships the classic charcoal theme as its default while the
Paper theme is built beside it; the two vocabularies are never mixed on one
surface. The redesign study under frontend/qa/redesign/ and the apraxia
redesign reference pages are where the system's application-facing patterns
came from, not an experiment set aside.

## Evidence on Hand

- README.md describes the app and development entry points.
- DESIGN.md records the design system as apraxia applies it, and links the
  system, the Paper mock, and the redesign reference pages it draws on.
- frontend/src/ contains the current implementation.
- frontend/qa/workspace.html provides fictional scenarios for local UI checks.
  Fixtures do not establish real persistence, provider access, or production
  behavior.

## Product Principles

1. Reduce executive-function overhead through easy capture and clear next actions.
2. Keep users in control of their own information and planning decisions.
3. Keep each change minimal and consistent with the existing product, and with
   the design system it is built on.
4. Make mistakes recoverable and preserve user data.
5. Expand through deliberately scoped modules as needs become clear.
