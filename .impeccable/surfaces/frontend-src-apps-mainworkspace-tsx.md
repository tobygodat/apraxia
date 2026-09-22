---
version: 1
slug: "src-apps-mainworkspace-tsx"
primary_target: "src/apps/MainWorkspace.tsx"
related_targets: []
---

# Workspace: the Crisp theme

Scope: the whole signed-in workspace (shell, home, tasks, projects, ideas, classes, career, settings, appearance, search, dialogs) as two new theme presets, `crisp` (dark, the new default) and `crisp-light`; "match device" follows Crisp. Classic and Paper stay selectable. Visitor mode: Operate.

Audience and job: one student-engineer (later friends) planning the day and week: capture, see what is due, act, tick. Constraints: PRODUCT.md truth (date-only due dates, overdue dates never rewritten, recoverable actions), no function changes between themes, reduced motion honoured, 1218×1133 desktop and 375px phone.

User pins (after rejecting two concept directions, Departures and a live-sky hero): "i like notion. very crisp" — research what makes Notion effective and follow it; visually striking, interactive, motion, a hidden Easter egg.

Memorable moment: ticking a Today task draws its check and the list closes the gap as a view transition. Hidden: the Konami code, or five quick taps on the mark, opens "Just one thing": today's first task alone with a two-minute ring; finishing throws confetti.

## Direction contract

THESIS: apraxia as Notion's system done properly: content is the interface, hierarchy from type not boxes, translucent warm neutrals, one blue for action, colour reserved for the person's data. It refuses the classic theme's mix of Georgia, 13px Segoe and filled calendar colour, and the Paper theme's words-for-buttons.

OWN-WORLD: Inter (opsz) only; dark #191919 page, #202020 sidebar, #f0efed ink, #ada9a3 muted, lines rgba(255,255,235,.1); light #fff, #f8f8f7, #2c2c2b; one blue #2783de/#2383e2 for primary buttons, checks, focus; Notion's nine tag tints for stages, statuses, types; red disc for today; 6px radii; 28–32px controls; menus and dialogs as raised surfaces with soft layered shadows.

STORY: the person sees what is due, overdue in red with the original date, and acts in place; the primary action is always visible, secondary controls appear on hover (always on touch).

FIRST VIEWPORT: home at 1218: 240px sidebar (Workspace label, current section under a gliding fill); 40px bold page name; date line with counts; Tasks header with the blue Add task; the Today rows; the week below with a red today disc and colour-barred event cards.

FORM: user-pinned (Notion), superseding seed 1726f865. Signature interactions: gliding section highlight, check draw plus view-transition completion, theme change as a circular reveal from the click, page arrival rise, the hidden "Just one thing" room.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
