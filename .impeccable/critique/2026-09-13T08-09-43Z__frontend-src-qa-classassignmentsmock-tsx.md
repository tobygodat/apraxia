---
target: Class assignment database and notes
total_score: 23
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 1
target_identity: "file:/mnt/c/Users/tobyg/.codex/worktrees/ef00/tobiOS/frontend/src/qa/ClassAssignmentsMock.tsx"
target_fingerprint: "sha256:478fc0272fb4e9a6994d3c6324839118773688aad2251edc498495f3d3b0d1e7"
target_path: /mnt/c/Users/tobyg/.codex/worktrees/ef00/tobiOS/frontend/src/qa/ClassAssignmentsMock.tsx
timestamp: 2026-09-13T08-09-43Z
slug: frontend-src-qa-classassignmentsmock-tsx
closed: true
---
⚠️ DEGRADED: single-context (spawn_agent unavailable in this session)

The page has a solid structure. The biggest opportunity is making it feel like a fluid, editable table rather than a table that temporarily becomes a form. This critique covers the fictional assignment prototype and its surrounding notes area, not production persistence.

Design specificity: the shell, serif course heading, flat rows and compact density fit orbitOS. The blue Add button feels borrowed from the reference; the colored type labels are a useful deliberate experiment, provided they remain secondary to names and dates.

| Heuristic | Score /4 | Assessment |
|---|---:|---|
| System status | 2 | Edits lack confirmation; completion has Undo. |
| Real-world language | 4 | Name, Date and Type are natural and concise. |
| User control | 2 | Escape works; recovery mostly covers completion. |
| Consistency | 2 | Creation and ordinary editing use different save rules. |
| Error prevention | 2 | Blank names are blocked, but silently. |
| Recognition | 3 | Main action is clear; editable cells need discovery. |
| Efficiency | 2 | Saving a new row drops keyboard focus. |
| Minimalism | 3 | Quiet table; oversized empty notes area. |
| Error recovery | 1 | Clearing a name silently restores the original. |
| Contextual guidance | 2 | Draft shortcut hint helps; normal editing gives little guidance. |
| Total | 23/40 | Acceptable foundation; interaction work needed. |

Strengths: assignments are first; class heading and back navigation retain the app pattern; date-before-type, regular names, subtle gridlines and one view make scanning straightforward.

1. [P1] Make adding and editing one coherent interaction. Add currently inserts both a draft and a second action row; existing cells save on blur. Live testing confirmed focus returns to BODY on save, and a new undated assignment moves near the bottom. Keep one temporary row at the top, match its geometry to existing rows, keep focus after saving, and complete sorting when editing ends. Tab should traverse fields; Enter commits; Escape cancels. Keep controls within the active row. Suggested command: impeccable harden.
2. [P2] Fit the width to the information. At 1080px, measured columns are checkbox 38px, Name 632px, Date 220px, Type 190px. Short dates and tags leave excessive gaps. Try a centered 900–960px table, Date 160–180px and Type 120–140px, with the remainder for Name. Preserve the left-aligned module header and column dividers. Suggested command: impeccable layout.
3. [P2] Reduce the empty notes footprint. The empty PDF reader occupies 320px below the Drive controls while offering another opening action. Show a compact empty state with Open from Drive and From device; expand the reader once a PDF is open. Suggested command: impeccable distill.
4. [P2] Make invalid edits understandable and recoverable. Emptying an existing name silently restores its old value. Keep the field active with a brief Name required message, retain the user's edit, and make successful saves clear without a toast on every keystroke. A contextual remove action with Undo is an optional addition for accidental rows. Suggested command: impeccable harden.
5. [P2] Bring the table controls closer to orbitOS. Use the existing neutral Add treatment. Keep type tags subdued and meaningful. Remove the Type header chevron unless the header actually opens something. Suggested command: impeccable polish.

Cognitive load is moderate: inconsistent save behavior and the large empty reader add unnecessary decisions. The six-entry Type menu is familiar enough that splitting it into more menus would be counterproductive. Emotional flow is calm on arrival, uncertain at commit, and disorienting when the row moves.

Persona checks: a frequent keyboard user loses focus after creating a row; a first-time user has to discover save-on-blur; a hurried student can lose the assignment they just edited when it sorts elsewhere.

Brainstorm directions:
- Lean table, recommended: keep the current columns and invest in proportions, editing and recovery.
- Assignment plus resource: add one Link field only if opening the assignment source is a repeated need. Avoid adding fields solely to occupy width.
- Notes when needed: keep the initial notes area compact and let the PDF reader expand only after selection.

Minor observations: the Type column scrolls out of view at 390px, although the page itself stays contained. Displayed dates should remain literal dates as requested. Completed rows can become a long-term density concern; a collapsed completed section is an optional alternative to filter tabs.

Deterministic scan: zero CLI findings for frontend/src/qa/ClassAssignmentsMock.tsx. The browser detector logged three page-wide anti-pattern flags without identifying their rules in the captured output; they are not treated as validated assignment-table defects. Direct browser interaction and source inspection support the priority issues.

Questions to consider: prioritize editing, table proportions, or the notes area? Keep the lean columns, or explore a resource link column?
