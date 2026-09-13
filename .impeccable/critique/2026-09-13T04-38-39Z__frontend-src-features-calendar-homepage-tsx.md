---
target: calendar
total_score: 26
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 1
timestamp: 2026-09-13T04-38-39Z
slug: frontend-src-features-calendar-homepage-tsx
---
Method: dual-agent (A: /root/design_review · B: /root/evidence_review)

The toolbar is resolved; event readability and editing recovery are the next priorities. The compact scale, 8 AM start, month/year heading, and absence of a legend are intentional requirements.

Design specificity: coherent and authored for orbitOS. Restrained dark surfaces support scanning; familiar calendar conventions fit this personal planning tool.

| Heuristic | Score / 4 | Evidence |
|---|---:|---|
| System status | 3 | Loading, refresh, and save feedback exist. |
| Real-world match | 4 | Familiar week structure and date labels. |
| User control | 2 | Unsaved editor dismissal is unguarded. |
| Consistency | 3 | Event interaction changes with edit capability. |
| Error prevention | 2 | Delete confirmation exists; draft loss is unguarded. |
| Recognition | 3 | Truncated event titles require inspection. |
| Efficiency | 2 | Keyboard creation exists; limited accelerators. |
| Minimalism | 3 | Calm layout; small secondary typography. |
| Error recovery | 2 | Retry exists; discarded drafts cannot be recovered. |
| Contextual help | 2 | Labels exist; grid gestures are not evident. |
| Total | 26/40 | Acceptable; focused usability improvements. |

Strengths: the month/navigation and action groups are clear; the compact grid provides useful day coverage; event colors carry meaning against neutral chrome.

Priority issues:
1. P1: Close/Escape silently loses unsaved event edits. Reproduced with a fictional title and Escape. EventEditor.tsx:72-74 calls onClose directly. Add a dirty-state guard offering Keep editing and Discard changes. Suggested command: /impeccable harden calendar editor.
2. P2: Crowded event titles are hard to identify. At the inspected desktop viewport, overlapping cards reached about 44px wide and clipped titles. Preserve the compact scale; offer readable details on focus and hover, with an equivalent touch path. Suggested command: /impeccable clarify calendar event details.
3. P2: Event click behavior changes with edit capability. HomePage.tsx renders anchors with Google links, then intercepts clicks in editable mode. This is not evidence of broken Enter handling, but destination and action are not obvious. Make the card action consistent and expose Open in Google Calendar separately if needed. Suggested command: /impeccable clarify calendar event actions.

Cognitive load: low to moderate. Five toolbar actions are separated into two useful groups, not an overloaded flat menu. Truncated titles create more friction than the toolbar. The emotional journey begins calmly but accidental draft dismissal undermines trust.

Personas: Alex must inspect clipped events to identify them; Sam may encounter differing card actions between writable and read-only states; Riley can lose a draft by pressing Escape. Minor observation: 9-10px secondary labels may strain low-vision readers; avoid enlarging the entire grid reflexively.

Detector: 0 findings, exit 0 on HomePage.tsx. Browser console: no warning/error entries. No detector overlay: browser evaluation is read-only. Fresh fixture tabs were inspected; provider behavior and live Google persistence were not verified. No application code changed during critique.

Questions: Prioritize draft protection or event readability? Keep the next pass to one issue or address all three?
