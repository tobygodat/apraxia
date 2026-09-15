# orbitOS

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Currently a personal workspace for its owner. The owner plans to give friends
access so they can use orbitOS for their own information and workflows.
Friends' access is a future product direction, not a claim of launch readiness.

## Product Purpose

Reduce the mental overhead of capturing, organizing, and acting on everyday
information. Tasks, projects, ideas, media, and class notes belong in one
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

- Existing workspace areas include Todos, Projects, Ideas, Media, Calendar,
  and a Classes/course-notes skeleton.
- Classes supports saved notes, local PDF preview, and Google Drive notes
  through Google's native Picker, with a separate Drive consent. Hosted setup
  and live provider verification are still pending, and no background Drive
  synchronization or Drive writes exist. See docs/DRIVE.md.
- Keep each person's information private to their account. Browser data access
  uses authenticated sessions and row-level security; provider credentials
  remain server-only.
- Preserve date-only due dates, unchanged overdue dates, atomic Today ordering,
  and recoverable actions.
- Preserve legacy source and data. Hosted schema changes are forward-only.
- New modules and broader access require scoped implementation decisions;
  neither is authorization to add unspecified features now.

## Brand Commitments

The product name is orbitOS. Favor direct, understandable language.
The isolated study under frontend/qa/redesign/ records an experiment, not
binding visual direction for the whole product.

## Evidence on Hand

- README.md describes the app and development entry points.
- frontend/src/ contains the current implementation.
- frontend/qa/workspace.html provides fictional scenarios for local UI checks.
  Fixtures do not establish real persistence, provider access, or production
  behavior.

## Product Principles

1. Reduce executive-function overhead through easy capture and clear next actions.
2. Keep users in control of their own information and planning decisions.
3. Keep each change minimal and consistent with the existing product.
4. Make mistakes recoverable and preserve user data.
5. Expand through deliberately scoped modules as needs become clear.
