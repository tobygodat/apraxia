---
target: orbitOS website design and layout
total_score: 27
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 0
timestamp: 2026-09-08T00-08-37Z
slug: frontend-src-apps-mainworkspace-tsx
---
Method: dual-agent (A: design_review · B: design_detector). Huashu Design and Impeccable review of the local cloud workspace.

Target: frontend/src/apps/MainWorkspace.tsx; Home, Tasks, Ideas, Media, Projects/detail, and Settings. Assessment A inspected the baseline independently; the parent verified the completed Tasks compaction at 1440px and 800px. These are design judgments from fixtures, not live-provider or comprehensive accessibility certification.

The calendar-and-tasks composition fits orbitOS. The neutral Notion palette, quiet sidebar, and serif headings support the requested calm, manual workspace. Collections still feel generic and spacious compared with Home. The biggest opportunity is to make information easier to scan through consistent density, readable calendar content, and predictable page spacing.

Keep the calendar-left/task-right structure, restrained colors and dividers, and recoverable editing/deletion. The compact Tasks rows now measure approximately 43px without metadata and 57px with metadata, with inline actions and wrapping long titles. Browser editing, deletion, Undo, and long-title layout passed. npm run verify passed all 1,668 tests, typechecking, build, and browser-bundle checks.

| Heuristic | Score /4 | Main evidence |
|---|---:|---|
| Status visibility | 3 | Clear status and overdue summaries |
| Familiar language | 3 | Project dates remain raw ISO/24-hour |
| User control | 3 | Editing, cancellation, Undo |
| Consistency | 2 | Different labels, actions, and page spacing |
| Error prevention | 3 | Busy controls and recoverable deletion |
| Recognition | 3 | Labeled navigation; some subtle controls |
| Efficiency | 3 | Search shortcut; collections remain spacious |
| Minimalism | 2 | Small calendar content beside generous empty areas |
| Error recovery | 3 | Retry and Undo; not every failure exercised |
| Help | 2 | Keyboard alternatives not consistently apparent |
| Total | 27/40 | Acceptable; density and consistency need work |

Huashu: philosophy alignment 8/10, hierarchy 7/10, craft 6/10, functionality 8/10, originality 6/10. Originality carries less weight for this deliberately Notion-inspired personal app.

1. **[P2] Calendar readability.** At a 1280px desktop viewport, overlapping events squeeze titles into fragments and clip times. Reduce unused gutters, give the calendar more of the Home split, and use a deliberate two-line title plus one-line time treatment. Preserve the seven-day view and current interactions. Source: frontend/src/features/calendar/calendar.css:6 and :64. Suggested command: /impeccable layout.
2. **[P2] Collection density and repetition.** Media rows are about 116px tall and project task rows about 88px in the reviewed fixture. Use approximately 60–72px for simple two-line records and keep creator/type/status together. Untitled Ideas repeat the same first sentence as heading and preview; remove the duplicate. Sources: frontend/src/features/collections/collections.css:18 and CollectionPage.tsx:163. Suggested command: /impeccable distill.
3. **[P2] Task language and dates.** The sidebar says Tasks, while Add and dialogs still say Todo. Project tasks show ISO dates and 24-hour times. Reuse Task terminology, human-readable date/time formats, and a consistent edit/delete treatment across views. Sources: frontend/src/apps/MainWorkspace.tsx:125 and frontend/src/features/collections/CollectionPage.tsx:165. Suggested command: /impeccable clarify.
4. **[P2] Shared page spacing.** Heading positions shift between Tasks and collections. The boxed Back to Projects control and generous project-header spacing push content down. Standardize page insets/title spacing and use a quiet back link. Sources: frontend/src/features/todos/TodosBoard.css:11, frontend/src/features/collections/collections.css:1, and CollectionPage.tsx:168. Suggested command: /impeccable polish.

Cognitive load: five navigation destinations and five Add choices remain understandable. Repeated idea text, inconsistent terminology, and separated metadata/actions create more avoidable effort. Arrival feels calm and Undo provides reassurance; scanning crowded events or oversized collection rows is the main friction.

Persona checks: frequent users have to reinterpret the same task in different views; keyboard/low-vision users face small calendar text and subtle controls; first-time users see Tasks become Todo and may not expect clicking a collection title to edit it. A full assistive-technology audit was outside this review.

Minor observation: the empty optional Home header can consume less height. Quick wins: remove duplicated Idea previews, finish Task/date wording, and align page headings.

Deterministic evidence: Impeccable CLI ran once on CloudAppShell, HomePage, HomeHeader, TodosBoard, CollectionPage, TodoComposerDialog, TodoEditDialog, SearchDialog, and WorkspaceDialog, returning zero findings (empty JSON array, exit 0). No detector candidates or false positives to classify. Assessment B independently measured overlapping calendar events at just 40px wide at 1280px and confirmed the duplicate Idea preview. It also confirmed intentional internal Tasks scrolling without page overflow. The static detector does not measure these layout problems. Its bounded contrast check found no functional-text failure; a decorative breadcrumb separator was excluded. No overlay was injected because the available evaluate API is read-only.

Follow-up preferences requested: prioritize calendar readability, denser collections, or cross-page consistency; choose compact collection rows throughout or a slightly roomier collection treatment. Further changes remain recommendations until requested.
