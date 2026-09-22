# Apraxia consumer product opportunities

Research date: September 22, 2026. Audience: students and early-career people who already use AI assistants. This is a recommendation, not an implementation commitment.

**Recommendation: make Apraxia the place where an assistant's advice becomes work the user can see, change, and resume. Package interview preparation as the first focused entry flow, with Classes and Projects supplying reusable context.** Keep the broader workspace useful independently of AI. A candidate should be able to arrive with one upcoming interview, create an actionable preparation plan, and return tomorrow without reconstructing the conversation.

The current product has much of the necessary structure. Career already contains interview rounds, questions, preparation items, reusable behavioral stories, and resources. Classes has assignments, Markdown notes, and PDFs; Projects connects tasks and ideas. Recurrence, the command palette, and the REST/MCP bridge are already present. The opportunity is to connect these capabilities into a clear consumer experience.

## Evidence and limits

This review combined repository inspection, recent Git history, local browser interaction, current primary-source research, and two independent GPT-5.6-Sol agents using high reasoning. The source baseline was `8b4a8e9`, with existing uncommitted collection changes present. Those changes were left intact.

Browser inspection covered the local Paper variant of Home, Tasks, Classes, class notes, Career, application preparation, capture, and empty states. Desktop checks used 1218 × 1133 CSS pixels and DPR 1.44; phone checks used 375 × 812. The `personal` fixture had no saved snapshot and therefore used fictional realistic data; dense and empty fixtures were also inspected. This was not an inspection of the deployed account. Fixtures do not establish database persistence, real assistant connectivity, or Google synchronization. The stored default theme remains Classic, so the Paper findings should not be generalized to every theme.

A local screenshot collage in `frontend/qa/local/product-review-2026-09-22/` records the reviewed states. It is an ignored local artifact, not a committed report asset. No application code, account settings, infrastructure, or hosted data was changed.

## Why this direction

Student familiarity with AI is substantial: HEPI's March 2026 survey reported AI use for at least one purpose among 95% of 1,054 surveyed full-time UK undergraduates. That is evidence of audience readiness, not willingness to adopt or pay for Apraxia, and it should not be treated as a representative US demand estimate. [HEPI survey](https://www.hepi.ac.uk/reports/student-generative-ai-survey-2026/)

The competitive baseline is already demanding:

| Existing capability elsewhere | Implication for Apraxia |
| --- | --- |
| Todoist lets assistants read and manage tasks through MCP, with OAuth and revocation. [Official documentation, updated September 4, 2026](https://www.todoist.com/help/todoist/todoist-and-ai/connect-todoist-to-an-ai-assistant-xMSzFfHng) | An MCP endpoint by itself offers little differentiation. Context and follow-through must make a particular task easier. |
| Google announced study notebooks that use course materials for diagnostic quizzes and adaptive lessons. [Google, June 25, 2026](https://blog.google/products-and-platforms/products/education/iste-students-2026/) | Generic study guides and AI tutoring face strong substitutes. Coursework remains useful as context and recurring work. |
| Notion supports custom agents with triggers, schedules, and scoped access to workspace material. Eligible higher-education users also have a free individual Education plan. [Custom Agents](https://www.notion.com/help/custom-agents), [Education plan](https://www.notion.com/help/notion-for-education) | A general configurable workspace with AI competes against a mature platform and a strong free alternative. |
| Simplify tracks applications; Teal offers role-specific AI interview practice with follow-up questions and feedback. [Simplify tracker](https://help.simplify.jobs/en/articles/2140179-using-the-job-tracker), [Teal interview practice](https://help.tealhq.com/en/articles/9990318-using-ai-interview-practice-agent) | Job tracking and mock-interview chat are already served. Test preparation grounded in the person's accumulated work and carried into daily action. |

These are documented competitor capabilities, not comparative usability tests or proof of their effectiveness.

Interview preparation is the strongest initial hypothesis because it offers a bounded, urgent outcome and fits the newest structured data. Coursework is the strongest fallback: it is more frequent and better integrated today, but faces duplicate-entry friction with existing school systems and strong free substitutes. A general personal workspace has the broadest scope and the least concrete reason to switch.

Career is episodic. Higher willingness to pay, reuse of coursework in interviews, and between-interview retention are all unvalidated. Treat Interview as a packaged workflow within Apraxia, not a requirement that the entire product become a career service.

## The first useful consumer journey

The entry promise should be concrete: **“Prepare for your next interview using your own experience, and know what to do today.”**

1. Paste a posting or recruiter message, or enter a role manually. Confirm the next interview date if known; a posting alone does not establish one.
2. Select relevant existing projects, notes, and behavioral stories. A new user can start with one short experience description rather than importing a whole life history.
3. Ask an existing assistant for a short plan, or create the plan manually. Show three to five proposed actions, their source context, and editable dates. Distinguish supplied facts from suggestions.
4. Save the selected actions once. They appear in both the application and Today, with the same completion and date state.
5. On the next visit, show the next interview, unfinished actions, and the material already prepared. After the interview, capture what was asked and what should be reused or improved.

For example, a class project and an existing story about a difficult team decision could support a preparation action such as “Draft a two-minute example for the teamwork question.” The system should point to that evidence. It should leave missing facts for the user to fill in.

Measure the time to the first correct saved action, including setup and corrections. A polished generated plan that stays in chat does not satisfy this journey.

## Highest-priority UI and UX work

| Priority | Observed behavior | Recommended change and acceptance condition |
| --- | --- | --- |
| 1 | A fictional Career prep item due today saved in its application but did not appear on Home. The UI omits the existing optional `todoId` link. | Connect actionable prep to the canonical task model. Adding, completing, or rescheduling from either surface must agree after reload. This requires a real persistence test when implemented. |
| 1 | At 1218 × 1133, Home placed the calendar before Today; actionable task rows were below the first screen. Empty Home retained a large empty calendar area. | At stacked desktop widths, show the next actions and next relevant event first. Keep the full calendar reachable. A first-time user should see a useful action or an explicit first-action prompt without scrolling. |
| 1 | Dense Paper Tasks produced a document width of 1442 pixels in a 1218-pixel viewport. Long titles became difficult to scan in narrow week columns. | Use an agenda layout at intermediate widths, or contain horizontal scrolling inside the board. The page itself must fit the viewport, and task text must remain readable. |
| 2 | Phone Tasks began with Sunday; the current Tuesday heading was below the first screen. Dense phone Home placed 15 overdue items before three due today. | Default the phone agenda to today. Keep overdue work visible as an accessible, counted group alongside a small set of chosen next actions. Preserve all deadlines and access to the full list. |
| 2 | Global Add asks for a type before opening a detailed task form. Six destinations have equal prominence. | Add a one-line capture entry with editable date/context chips and expandable details. Prioritize Today, Capture, Search, and pinned active contexts; expose other sections as needed. Retain the existing full forms and command palette. |
| 2 | Empty states describe storage categories, while Career's useful depth appears only after creating records. | Start Career with “Add a role or paste a posting,” then create one preparation action. Start Classes with one current assignment. Defer integration setup until its benefit is clear. |

Source anchors: [Home ordering](../frontend/src/features/calendar/HomePage.tsx), [stacked calendar geometry](../frontend/src/features/calendar/calendar.css), [Paper week layout](../frontend/src/features/todos/todosPaper.css), [Career prep creation](../frontend/src/features/career/CareerPrepTab.tsx), [global capture chooser](../frontend/src/apps/MainWorkspace.tsx).

Keep the Paper visual identity: editorial typography, restrained green, whitespace, and rules. The most important visual change is hierarchy. A useful first viewport contains the next action, its context, and the next time constraint. Avoid filling it with summary cards that merely count stored objects.

For capture, follow the proven interaction pattern of one text field with optional metadata; Todoist documents natural-language dates and recurrence in Quick Add. Ambiguous input should keep its original text and invite correction. [Todoist Quick Add](https://www.todoist.com/help/todoist/features/use-task-quick-add-in-todoist-va4Lhpzz)

On mobile, prioritize capture, search, and the current day's work. A responsive web/PWA capture flow and text/link sharing experiment can precede a native app. Verify browser support before promising share-sheet or offline behavior. Future UI changes should preserve keyboard access, visible focus, readable source labels, and touch-friendly edit controls; this review did not establish a complete accessibility audit.

## Useful Notion-style modularity

Introduce **reusable page sections on existing typed records**. Users can show, hide, and reorder a small set of sections; the application continues to understand what an interview, class, or project means.

| Shared section | Interview page | Class/project page |
| --- | --- | --- |
| Overview and next milestone | Role, next round, known date | Course/project purpose and next deadline |
| Linked actions | Preparation tasks | Assignments or project actions |
| Notes | Process notes and debrief | Existing Markdown notes and decisions |
| Sources | Posting, recruiter message, selected resources | PDFs, links, and project artifacts |
| Reusable material | Behavioral stories and question answers | Accomplishments, worked examples, and project evidence |

Start with an Interview template and an optional Semester template. Existing Projects can supply shared context. Make the template useful immediately; choosing and configuring modules should not become an onboarding exercise.

The first small feature could be **“Turn this checklist into tasks”** from a Markdown note. Preview the selection, choose its context, and create linked canonical tasks. The existing Markdown checkboxes are read-only renderings of note text, so this needs explicit conversion and visible links; silently maintaining two independently editable checklists would create confusion. [Markdown rendering](../frontend/src/components/markdown/MarkdownView.tsx)

Reuse presentation components and typed service contracts. A lightweight registry can describe section rendering, navigation, search results, and available agent actions. Do not begin by replacing domain tables with a universal block database. Capacities' custom object types include properties, layouts, and dashboards; that illustrates the size of the configuration product one would otherwise be taking on. [Capacities object types](https://docs.capacities.io/reference/content-types)

Add new section types only after repeated workflows need them. User-defined schemas, formulas, nested databases, and a public template marketplace would materially enlarge the product and support burden before its basic return loop is validated.

## Assistant experience and backend priorities

The consumer-facing connection should read like “Connect your assistant” and explain which contexts it can access. It should show connection status, recent activity, and revocation. Tokens and protocol setup belong behind that experience.

The current bridge has useful safeguards already: explicit scopes, server-owned account identity, version checks, durable idempotency, and Google write reconciliation. Preserve them. However, its configured bearer token maps to one fixed owner; it is not a per-account consumer connection. [Existing API contract](../docs/AGENT_API.md)

The work should proceed in this order:

1. **One action, one state.** Use the existing Career prep-to-todo seam. The task owns completion and action dates; Career owns its interview context. Make linked mutations atomic and preserve existing ownership checks. Keep a planned work date separate from a true deadline if planning requires both. Rescheduling preparation must not silently change an interview or assignment deadline.
2. **Close the capability gaps.** The agent schema exposes todos, projects, ideas, classes, and notes, but no Career domain. It also lacks writable recurrence fields and explicit class-note writes. Add only the operations required by the selected workflow, with the same rules as the browser. [Agent schema](../server/agent/agentSchema.ts)
3. **Provide a bounded context handoff.** Assemble the selected application, its upcoming round, relevant actions, and user-selected evidence with source identifiers and freshness. Start with pasted text and existing Markdown. Add extracted PDF text with page references only when the pilot shows it is needed. The present API offers PDF bytes, not an extracted-text retrieval service. An embeddings platform is not a prerequisite for the first experiment.
4. **Review meaningful batches.** Show proposed additions and edits with their sources, then save the accepted batch. Reuse version checks and idempotency so retrying cannot duplicate work or overwrite intervening edits. Return an understandable receipt. Offer undo only for changes that can actually be reversed safely; represent partial or uncertain provider outcomes honestly. Let authorization settings govern routine actions instead of adding a confirmation dialog to every harmless edit.
5. **Add per-account access before external assistant pilots with real accounts.** Bind credentials to the authenticated user, support scoped grants and revocation, and test cross-account isolation. OpenAI's current authenticated MCP guidance expects OAuth 2.1. The owner's fixed bearer credential must not become a shared pilot credential. [OpenAI authentication guidance](https://developers.openai.com/plugins/build/auth)
6. **Make external changes visible.** The existing journal records agent writes, not every browser or Google change. Extend provenance where the workflow needs it and make the open page refresh after assistant changes. Existing focus revalidation should be reused. Include who changed what, its source, and when; keep user statements distinct from model suggestions.

Before broad consumer onboarding, also verify export/delete flows and the intended Google authorization configuration. These are product gaps to assess, not evidence that the current personal deployment is failing.

A low-cost experiment can use **Copy brief for AI** and **Import AI plan** with an editable preview. That tests the state handoff without first building hosted inference or every assistant connector. Manual planning should remain available. School-managed assistant accounts and host-specific access rules can complicate connection, so account availability needs direct testing with the intended audience.

There is also a promising distribution experiment: put a compact **Review preparation plan** component inside the user's assistant. MCP Apps supports interactive tool interfaces; OpenAI documents support for the shared UI standard. Reuse pure presentation components, with host-mediated tool calls and a text fallback. The existing browser component depends on browser services and cannot simply be embedded unchanged. [MCP Apps overview](https://apps.extensions.modelcontextprotocol.io/api/documents/overview.html), [OpenAI UI architecture](https://developers.openai.com/plugins/concepts/plugins)

Prototype that surface after the action/context flow works. Support for a UI standard does not by itself establish installation availability for every account. Likewise, MCP's July 28, 2026 release is newer than the versions advertised by Apraxia; test target clients before calling the current adapter incompatible or prioritizing a protocol rewrite. [MCP release](https://blog.modelcontextprotocol.io/posts/2026-07-28/)

## Sequence, validation, and commercial uncertainty

| Stage | Deliverable | Evidence needed to continue |
| --- | --- | --- |
| A: Make current work actionable | Prep-to-task integration, visible Today, contained Tasks layout | One prep action remains consistent across its application, Today, and reload; desktop and phone show the intended work. |
| B: Test one useful handoff | Posting-first entry, selected evidence, editable plan import, change receipt | Candidates reach a correct next action with less total effort than their current assistant-plus-tracker process. |
| C: Connect assistants | Per-account authorization, focused Career tools, current context and provenance | Setup works on intended accounts; changes are scoped, correct, visible, and recoverable. |
| D: Expand only from use | Reusable sections, Semester template, optional in-assistant review component | Repeated use demonstrates the need for the added template or surface. |

Run observed sessions with 8–12 students or recent graduates who have an interview within roughly two weeks and already use an assistant. Before implementing general modularity, a fictional-data prototype can test comprehension and navigation. A live data pilot requires the appropriate account boundaries first.

Compare against each person's actual workflow, including a general assistant with a tracker or document. Count setup, review, corrections, and duplicate entry. Test a new role or interview round rather than repeatedly demonstrating a memorized example.

Suggested decision rules are product judgments, not research-established benchmarks: aim for at least eight of ten participants to save a correct first action unaided in about three minutes, and at least half to return voluntarily and act on or update their preparation during the interview window. Look for reuse of an existing story or project in a second context. Investigate every silent date, ownership, or duplication error before expansion. Record whether users choose to keep the workflow when their current tools remain available.

Do not infer better hiring outcomes from task completion. The early claim to validate is less reconstruction and more reliable follow-through. If users prefer copying a one-off plan into Todoist or a document and do not return for saved context, reconsider the thesis before building more modules.

Willingness to pay remains unknown. Test it only after repeat value, comparing an active-search subscription with a time-bounded search pass. Keep reasoning/API cost and review overhead visible in the experiment; do not promise unlimited hosted AI before measuring them. Exportable context should help establish trust rather than create retention through lock-in.

The first implementation should therefore be three bounded changes: connect Career prep to canonical tasks; make those tasks visible on desktop and phone; and provide an editable plan handoff from a selected application. Defer generic chat, autonomous applications, broad school-system integrations, a universal block editor, and a separate weekly-review destination. The potential advantage is accumulated useful context that reduces work on the next visit, and the pilot needs to demonstrate it.
