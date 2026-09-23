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
- Each class has one written markdown notes document beside its assignments.
  Classes hold no file attachments and have no Google Drive connection.
- Keep each person's information private to their account. Browser data access
  uses authenticated sessions and row-level security; provider credentials
  remain server-only.
- Preserve date-only due dates, unchanged overdue dates, atomic Today ordering,
  and recoverable actions.
- Visual theme is a device-local preference, not an account setting; Crisp is
  the default. Changing it never changes what a screen can do.
- Preserve legacy source and data. Hosted schema changes are forward-only.
- New modules and broader access require scoped implementation decisions;
  neither is authorization to add unspecified features now.

## Brand Commitments

The product name is apraxia, lowercase.

Since 22 September 2026 its default look is **Crisp**, in a dark and a light
theme: the owner asked for a redesign in the manner of Notion, "very crisp",
after research into what makes Notion's interface effective. Crisp takes that
system's discipline rather than its brand: content is the interface; hierarchy
comes from type, not boxes; neutrals are warm and translucent; one blue means
"act here"; and colour belongs to the person's data, as tag tints on stages,
statuses and types. It fixes the weaknesses people report in Notion: primary
actions stay visible, secondary text keeps reading contrast, a row's controls
stay in view on touch, and Home is an opinionated day rather than a blank
page. Motion is short and explains a change. DESIGN.md records the system and
is binding for Crisp.

The Toby Godat design system (warm paper, Literata, one green that means
"here", rules instead of boxes, words instead of buttons) continues as the
Paper theme, and the charcoal classic theme stays selectable. Each theme keeps
its own vocabulary, and the three are never mixed on one surface.

Voice: facts are stated with their numbers rather than with adjectives. Items
on a line are joined with a spaced middle dot. Errors say what happened and
what to do, in a sentence, without blame. No emoji. Crisp and classic print
interface words in sentence case; Paper lowercases them and prefixes section
headings with a green `// `.

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
