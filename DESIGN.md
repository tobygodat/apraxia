---
name: "apraxia"
description: "A personal workspace with charcoal surfaces, serif page headings, and restrained controls."
colors:
  primary: "#f0efed"
  today: "#8b9bff"
  canvas: "#191919"
  sidebar: "#202020"
  hover: "#292929"
  selected: "#2c2c2c"
  line: "#303030"
  muted: "#ada9a3"
  field: "#111111"
  dialog: "#181818"
  raised: "#242424"
  error: "#ffb4b4"
  overdue: "#ddb1a4"
typography:
  headline:
    fontFamily: "Georgia, \"Times New Roman\", serif"
    fontSize: "38px"
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: "-1px"
  section-heading:
    fontFamily: "Georgia, \"Times New Roman\", serif"
    fontSize: "26px"
    fontWeight: 400
    letterSpacing: "-0.01em"
  ledger-date:
    fontFamily: "\"Space Grotesk\", \"Segoe UI\", system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 500
    letterSpacing: "-0.02em"
    fontFeature: "tabular-nums"
  ledger-weekday:
    fontFamily: "\"Space Grotesk\", \"Segoe UI\", system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 400
  body:
    fontFamily: "\"Segoe UI\", system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  navigation:
    fontFamily: "\"Segoe UI\", system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  label:
    fontFamily: "\"Segoe UI\", system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  dialog-action:
    fontFamily: "\"Segoe UI\", system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.025em"
  sign-in-headline:
    fontFamily: "\"Space Grotesk\", sans-serif"
    fontSize: "52px"
    fontWeight: 500
    lineHeight: 0.98
    letterSpacing: "-0.045em"
  sign-in-eyebrow:
    fontFamily: "\"JetBrains Mono\", ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.08em"
rounded:
  compact: "4px"
  navigation: "5px"
  collection: "7px"
  field: "8px"
  toast: "10px"
  dialog: "14px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  control-gap: "12px"
  md: "16px"
  lg: "24px"
  ledger-gutter: "28px"
  page-top: "36px"
  ledger-row-gap: "40px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.dialog}"
    typography: "{typography.dialog-action}"
    rounded: "{rounded.pill}"
    padding: "9px 17px"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
    typography: "{typography.label}"
    rounded: "{rounded.navigation}"
    padding: "7px 12px"
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.primary}"
    rounded: "{rounded.field}"
    padding: "10px 12px"
  navigation:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.navigation}"
    rounded: "{rounded.navigation}"
    padding: "9px 11px"
  navigation-active:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.primary}"
  day-choice:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.compact}"
    padding: "3px 9px"
  task-row:
    backgroundColor: "transparent"
    typography: "{typography.body}"
    height: "40px"
    padding: "0 6px"
  ledger-day-header:
    backgroundColor: "transparent"
    typography: "{typography.ledger-date}"
    padding: "0 0 8px"
  ledger-day-header-today:
    textColor: "{colors.today}"
  ledger-today-rail:
    backgroundColor: "{colors.today}"
    width: "2px"
  ledger-add-slot:
    backgroundColor: "transparent"
    textColor: "transparent"
    typography: "{typography.label}"
    height: "42px"
    padding: "0"
  ledger-add-slot-hover:
    backgroundColor: "#2b2b2b"
---

# Design System: apraxia

## Overview

**Creative North Star: "The Quiet Desk"**

apraxia uses dark neutral surfaces, warm light text, and familiar document typography. Georgia page headings give the workspace a personal character; Segoe UI keeps navigation, forms, and dense task information practical.

Hierarchy comes from spacing, fine rules, and small changes in surface tone. Calendar fills and status colors carry information; the surrounding interface stays restrained.

The user-confirmed descriptive direction is “The Quiet Desk — calm and personal.”

**Key Characteristics:**

- Charcoal surfaces with warm light text.
- Serif page headings and compact sans-serif controls.
- Fine dividers, flat rows, and quiet interaction states.
- Ruled ledgers: hairlines keep ruling where nothing is written.

This document records the implementation in `frontend/src/`, not what is deployed. Its visual evidence is especially `components/app-shell/CloudAppShell.css`, `apps/workspace.css`, `features/calendar/calendar.css`, `features/todos/`, and `features/collections/collections.css`. The experiment under `frontend/qa/redesign/` has its own scope.

Frontmatter records reusable observed values; most are still CSS literals or component-scoped properties, not centralized application tokens. It follows the [DESIGN.md format](https://raw.githubusercontent.com/google-labs-code/design.md/main/docs/spec.md).

## Colors

The palette is neutral charcoal, with warmth supplied by light text and muted grey labels, and one cool accent reserved for today.

### Primary

- **Warm Paper** (`primary`): main text, keyboard focus, selected dates, and primary save actions. Primary buttons use dark dialog-colored text.

### Secondary

- **Today Periwinkle** (`today`): the Tasks board's single accent, and the board's only marker of the current day. In the ledger it colors the today column's date numeral, the 2px rule under its header, and the 2px rail that carries that rule down the column's full height; in the classic theme it colors the today column's 1px border, its header rule, and its heading text. It also tints text selection on the page at 35% alpha. It is a place marker, never a control color, a status color, or a fill. Its neutral alternative (a brightness step instead of a hue) was left unresolved in the surface brief; the shipped value is the periwinkle.

### Neutral

- **Charcoal Canvas** (`canvas`): main workspace background.
- **Sidebar Charcoal** (`sidebar`): navigation surface, separated by a fine rule.
- **Hover / Selected Charcoal** (`hover`, `selected`): small shifts for navigation and quiet controls.
- **Graphite Rule** (`line`): shell, calendar, and section separation.
- **Warm Grey** (`muted`): secondary labels and supporting text.
- **Ink Field** (`field`), **Dialog Charcoal** (`dialog`), and **Raised Charcoal** (`raised`): editable fields, task dialogs, and floating menus.

### Semantic and data colors

- **Soft Error Rose** (`error`): collection and task-form error text.
- **Overdue Clay** (`overdue`): overdue task metadata.
- Calendar colors are dynamic. `calendarColors.ts` preserves valid Google fills, supplies stable fallbacks, and selects black or white event text by luminance. The fallback colors are not a global brand palette.
- Component-scoped translucent whites remain intentional: task-dialog text, muted text, and borders use their local variables. Do not silently replace these with shell tokens. The Tasks board's own set is text at 93% white, muted at 62%, faint at 52%, hairlines at 12% (filler slots at 8%), the day-header rule at 30%, and hover raises of `#262626` (rows) and `#2b2b2b` (add slot).

**The Semantic Color Rule.** Keep the interface neutral. Calendar fills identify calendars; warm error and overdue colors communicate status.

**The One Lit Column Rule.** Today Periwinkle is the recorded exception to the Semantic Color Rule: exactly one day column per Tasks board carries it, and it is always the current day. It draws that column's outline in the theme's own material — a rail and header rule in the ledger, the existing border in the classic theme — and never a fill. Nothing else on any surface borrows it.

## Typography

Page headings pair Georgia with a Times New Roman/serif fallback; body text and controls use Segoe UI, system-ui, sans-serif. The hierarchy is role-based rather than a mathematical scale.

Two families are actually bundled. `frontend/public/fonts/fonts.css` is linked from `index.html` and self-hosts Space Grotesk (400/500/700) and JetBrains Mono (400/500). They are used by the sign-in screens in `index.css` and by the preserved legacy `orbit-shell` styles. Inside the cloud workspace, Space Grotesk now has one role: the Tasks board's day headers (`ledger-date`, `ledger-weekday`), with Segoe UI as its fallback. Everything else in the workspace still relies on the system Georgia and Segoe UI stacks. Both sets are recorded in the frontmatter; `sign-in-headline` and `sign-in-eyebrow` use the bundled faces. The sign-in headline is a `clamp(30px, 5vw, 52px)` scale; the frontmatter records its upper bound.

- **Headline:** the frontmatter's shared page title treatment, applied to Tasks, collection pages, Classes, and Calendar settings.
- **Section heading:** a smaller Georgia step (26px, weight 400, -0.01em) for a band heading beneath a page's main content; on Tasks it titles the Inbox band. It sits between the 38px headline and the 32px cover title without replacing either.
- **Ledger date / weekday:** the Tasks board's column headers. The date numeral and month are Space Grotesk 500 at 22px with tabular numerals and -0.02em tracking; the weekday sits on the same baseline at the right in Space Grotesk 400, 22px, white at 50% alpha (60% on today). These sizes are off the previously recorded ramp and are recorded here as the ledger's own step.
- **Body:** compact task-row text. Collection titles use a slightly larger treatment (14px, weight 500); supporting descriptions use relaxed line height. Ledger rows use 13px at 1.4 line height with 11px metadata separated by a faint middle dot.
- **Navigation / Label:** familiar sans-serif controls. Smaller metadata varies by context (10–12px); these values document the current density.
- **Dialog:** titles use sans-serif (18–22px, weight 500); inputs are larger (15–16px) than their labels.
- **Home:** the visible title is optional. A plain title uses Georgia (38px); cover titles use a smaller treatment (32px, reducing to 27px below 900px). Do not force a heading into the hidden-title state.
- **Numbers:** calendar time labels, event times, the Tasks week range, and ledger dates use tabular numerals. Uppercase weekday labels are local to the calendar; ledger weekdays are title case.

**The Heading Rule.** Use the shared serif treatment for workspace page titles. Keep controls, metadata, and dialog titles in their existing sans-serif styles.

**The Grotesk Numeral Rule.** Space Grotesk enters the workspace only where a date is the heading itself. It is not a second body face, a label face, or a replacement for Georgia on page or section titles.

## Layout

The desktop shell has a sticky sidebar (200px) and a flexible content column, with a top header (62px). Shared page insets use `clamp(20px, 2.5vw, 36px)`; ordinary pages start 36px below their header. Spacing is not a strict single-unit grid: compact controls also use 5px, 7px, 9px, and 14px adjustments.

- At 1200px and below, the sidebar narrows to 174px.
- At 980px and below, it becomes a 64px icon rail; labels stay accessible.
- At 620px and below, navigation wraps into a horizontal header with visible labels, and the top content header becomes 54px tall.
- Home places a flexible weekly calendar beside a task column sized with `clamp(280px, 24vw, 340px)`. At 900px and below, the calendar and tasks stack; each retains an internal scrolling region.
- Collection pages are left-aligned within the shell and capped at 1120px. Text descriptions may use a 72ch reading width.
- Task dialogs cap at 580px and scroll when needed. Below 560px, detail fields become one column and the dialog sits near the bottom with reduced outer spacing.
- Classes uses a wider local layout (up to 1440px) and a notes split that stacks below 760px.

The Tasks board is a week ledger, not a scrolling kanban. Day columns fill the content width in equal tracks (six on desktop) with 28px gutters and 40px between wrapped rows; no horizontal scroll. The current week opens on today and runs forward to Sunday, then wraps to the week's earlier days, so the day being worked on is always the board's first column; a navigated week holds no today and stays in Monday-first order. When seven dates are visible, the last two share the last track, stacked 36px apart with their own headers — on the current week those are the days furthest behind today, which carry completed work only. Each column runs to a fixed ruled depth: task rows (40px minimum), then a 42px add slot, then inert 42px filler slots so a full column reaches nine rows and a stacked one reaches four. Beneath the week, after 56px, the Inbox band lays unscheduled tasks in auto-fill columns of at least 220px with the same 28px gutter, on a repeating 41px ruled background at least three rules deep. At 1180px and below the week reflows to auto-fill tracks of at least 200px; at 620px and below it becomes a single column, the toolbar stacks, and filler slots collapse to one per day.

At 620px and below the workspace is laid out for a phone rather than narrowed:

- Home leads with Tasks. The panels swap in the markup, not with a CSS `order`, so the reading and tab order swap with the visible one. Today takes the height it needs and the page scroll runs through it; the week calendar follows, separated by 28px and a hairline, in its own scrolling region capped at `min(62dvh, 520px)`, its month title stepping from 19px to 15px so the toolbar holds one line. A row's edit and delete, which touch puts on a second line, sit at that line's end.
- The classic board's sideways scroller becomes a vertical stack of full-width day columns at their natural height, led by the same today column the desktop board opens on. Its toolbar stacks the way the ledger's already does: title, week range, then the controls.

Where a coarse pointer is reported, the ledger's two reveal-on-hover affordances rest visible instead — the add slot's label and a row's edit and delete — because a touch device has no pointer to bring them out. The ruling and the geometry are unchanged.

These are observed responsive rules, not a claim that every mobile flow has been validated. Home cover sizing and scrolling are controlled by its existing layout logic.

## Elevation & Depth

Persistent workspace content is mostly flat. The sidebar's lighter tone, section rules, and local hover fills provide separation. Floating surfaces use actual shadows:

- Account menu: `0 12px 32px #0005`.
- Workspace notice: `0 8px 24px #0006`.
- Workspace dialog: `0 20px 60px #0008`.
- Task dialog: `0 24px 70px rgba(0, 0, 0, 0.48)`.
- Tasks undo toast: `0 18px 48px rgba(0, 0, 0, 0.42)` on a `#252525` surface with the toast radius.

**The Flat Workspace Rule.** Use tonal surfaces and rules for persistent content. Reserve substantial shadows for temporary menus, notices, and dialogs.

Navigation changes color and background over 140ms; task-dialog controls transition over 150ms. The task dialog enters over 180ms with a small upward movement and scale change. On the Tasks board, motion is limited to three moments: a row's hover raise over 160ms (`cubic-bezier(0.2, 0.8, 0.2, 1)`), the 120ms reveal of a row's checkbox and actions, and the week change, which fades the whole ledger in from 8px below over 220ms with the dialog's exponential ease-out (`cubic-bezier(0.16, 1, 0.3, 1)`), keyed to the visible week. Preserve the existing reduced-motion overrides; the ledger's disables all three.

**The Three Moments Rule.** A ruled surface animates only on hover raise, action reveal, and a change of the whole page's subject. Rules, headers, and filler slots never move.

## Shapes

The system uses restrained rectangular geometry, fine borders, and modest corner rounding. Frontmatter names the observed corner values by component role rather than claiming a universal scale.

Compact calendar controls and checkboxes use the compact radius. Shell navigation and Add use the navigation radius; collection actions use the collection radius; editable fields use the field radius. Task dialogs are softer, with the dialog radius and pill-shaped action buttons. Workspace dialogs remain square; event dialogs have their own modest rounding. Avatars and the selected calendar date are circular. The Tasks undo toast uses the toast radius.

Ruled surfaces have no corners at all: ledger rows, add slots, filler slots, and day headers are open rectangles bounded by a single bottom hairline. A day header's rule is 2px; rows and slots are 1px. Nothing on the ledger is boxed.

## Components

### Buttons

Primary save actions pair Warm Paper with dark text and brighten to white on hover. The task-dialog variant has pill corners, a 42px minimum height, and compact labels. Collection primary actions use a 38px minimum height and modest corners instead.

The shell Add button is a transparent bordered rectangle with a 34px minimum height; hover lightens its background and border. Calendar toolbars use smaller controls. The Tasks board's prev/Today/next and Source controls are transparent 44px hairline-bordered rectangles at the navigation radius whose border and text brighten on hover. Preserve these contextual differences.

Focus is generally a light 2px outline with a 3px offset. Pending/disabled actions become translucent; preserve each component's native disabled or aria-disabled behavior.

### Inputs

The task dialog's Repeats menu reveals its interval and end date only once a frequency is chosen, so ordinary capture keeps its length. The interval is a narrow number box with its unit ("weeks") on the same line in muted text, which the box names as its description.

Dark inset fields have visible borders, rounded corners, and comfortable inner padding. Collection and task-dialog fields have a 44px minimum height. Task-dialog borders strengthen on hover; invalid fields gain a rose border and accompanying error text. Keep labels and error messages connected to their controls.

### Navigation

A labeled icon sidebar anchors the desktop workspace. Active destinations receive a selected-charcoal fill and brighter text; hover uses a slightly quieter fill. Search appears above the destinations; the account control sits below them. Icons use the existing inline SVG vocabulary (24-unit viewBox, 1.5 stroke, rounded ends), usually rendered at 18px.

### Selection controls

The Today/Tomorrow switch is a compact pair of rectangular buttons, with a filled selected state and visible focus. There is no general-purpose chip/tag system in the cloud workspace: collection filters use selects, while task metadata remains text. Where a chip does appear (a task row's source, an assignment's type) it is the same bordered 11px muted chip. On the Tasks board the source chip is flattened into plain 11px muted metadata.

### Lists and containers

Collection entries and task-board “cards” are flat rows divided by thin rules. The class assignments table keeps the same rule: hairlines between rows, no vertical cell borders, and the row's trash icon for delete. Task-board rows expose compact checkbox, text, metadata, and action areas; hover adds a raised-charcoal tone. Completion dims and strikes through task text. Keep long titles wrapping and metadata subordinate.

### Week ledger (Tasks)

The Tasks board's signature: a planner spread where every day is a ruled column and the ink shows how heavy the day is.

- **Day header:** date left in the ledger-date treatment, weekday right in the ledger-weekday treatment, baseline-aligned with an 8px gap, 8px above a 2px rule at 30% white.
- **Today's bracket:** the today column swaps its date and header rule to Today Periwinkle and lifts its weekday to 60% white. That rule then turns the corner into a 2px rail down the column's full height, set 14px out into the gutter by an offsetting negative margin so the week's tracks stay aligned. The bracket is ruled ink, not a box: the column keeps the same border, background, and width as every other day.
- **Task row:** a 40px-minimum single-line row on a 1px hairline (12% white), bleeding 6px into the gutters so its hover raise (`#262626`, also on focus-within) reads as a band. A 15px compact-radius checkbox sits at 55% opacity until the row is hovered or focused; checked, it fills 72% white with an inset ring of the board surface. Edit and delete are 24px icon buttons at the row's end, hidden until hover or focus and always shown where the pointer is coarse or in forced-colors mode. Completed rows strike the title in faint white; past-due dates use Overdue Clay; a busy row dims to 58%. A repeating task adds its cadence ("Weekly", "Every 2 weeks") to the same metadata line, behind a 12px repeat glyph from the shared icon vocabulary at 85% opacity; the spoken form is the whole sentence, since the glyph alone says nothing.
- **Add slot:** a 42px full-width ruled row whose 12px label is invisible at rest and appears in muted white on hover or focus over a `#2b2b2b` raise. Where the pointer is coarse the label rests in muted white, since nothing would ever reveal it. It is a row that has not been written yet, not a button.
- **Filler slot:** an inert 42px row with an 8% hairline; it keeps the column ruled to its fixed depth and carries no interaction.
- **Inbox band:** the section heading followed by tasks flowing across auto-fill columns over a repeating 41px ruled background, so empty space is still ruled.
- **Undo toast:** the board's only floating surface, fixed bottom-right, 440px wide at most, with the toast radius, a 20% white border, and its own shadow.

### Weekly review ledger

The read-only `/review` page reuses the ledger vocabulary one level down: where
the Tasks board rules the week by day, this page rules it by project and class,
so the group name takes the place the date holds there.

- **Sheet:** a sticky margin (`clamp(150px, 15vw, 212px)`) beside the bands, 28px
  gutter. The margin holds the week's standing: a 2px 30% rule over three 40px
  hairline rows, each a label with its count at the right in tabular numerals
  and an anchor to its band. At 900px and below the margin lays down as a
  horizontal tally strip above the bands; at 620px the bands become one column.
- **Band:** Finished, Slipped and Next in that order, 56px apart, each a
  section heading with a 12px muted caption naming its count and date range,
  then its groups in auto-fill columns of at least 250px (220px below 1180px)
  with the same 28px gutter.
- **Group header:** the project or class name in 13px weight 500, its count at
  the right in 11px muted tabular, 8px above the day header's 2px rule at 30%
  white. The name links to that project or class while the workspace still
  lists it, and is plain text once it no longer does; nothing else on the page
  is interactive.
- **Entry row:** the board's 40px hairline row without its controls. Nothing is
  actionable, so rows have no hover raise and no checkbox. Finished entries are
  deliberately *not* struck through: a whole band of struck text is unreadable
  and the heading already says Finished, so the completion date carries it.
  A due date already past today uses Overdue Clay and a "N days late" count,
  in Next as well as Slipped.
- **Empty band:** the Inbox band's repeating 41px ruled ground, three rules
  deep, with one faint line of copy on it rather than a blank space.
- **Controls:** the Tasks board's own prev / This week / next rectangles, and
  its `rgba(255,255,255,0.1)` / `0.2` control-border pair as local tokens. Next
  is disabled on the current week: a week that has not happened has nothing to
  review. Text selection is a neutral warm paper at 22%, not the board's
  periwinkle, which stays on the board.

### Calendar and Today

Solid calendar event blocks carry the calendar's color. Dense events truncate text to fit their geometry, while the surrounding time grid remains neutral. Today uses compact task rows, overdue-colored metadata, and small edit/delete controls. Retain their accessible names and keyboard reorder behavior.

### Overlays and personal imagery

Account menus and dialogs use stronger borders and shadows to distinguish temporary layers. The optional Home cover is user content, with a dark gradient behind its title and controls. It is not a requirement for imagery elsewhere.

## Do's and Don'ts

### Do

- Do reuse the cloud shell palette, shared page insets, and serif page-heading treatment.
- Do retain visible keyboard focus, accessible icon labels, and reduced-motion behavior.
- Do keep calendar data colors and error/overdue semantics distinct from interface chrome.
- Do preserve local component variants when extending an existing surface.
- Do keep Today Periwinkle to the Tasks board's today column: its date numeral, header rule, and rail in the ledger; its border, header rule, and heading in the classic theme. Nothing more, and never as a fill.
- Do open the current week on today so it leads the board, and let the week's earlier days wrap to the end rather than dropping them.
- Do carry the ledger's rules and hairlines to a new surface that reports on the same records, stepping the type down rather than inventing a second vocabulary.
- Do let a ruled surface keep ruling through empty space with inert filler slots rather than collapsing to a blank column.

### Don't

- Don't treat the isolated QA redesign study or legacy orbit-shell styles as the cloud workspace design authority.
- Don't turn flat collection and task rows into elevated cards by default.
- Don't apply the dialog's pill buttons or larger radius to every toolbar.
- Don't interpret the documented desktop density as a verified mobile accessibility standard.
- Don't leave an affordance that only hover reveals without a coarse-pointer resting state; on a phone it is not there at all.
- Don't put borders, backgrounds, or counts around ledger columns — today's rail is a rule beside a column, not a box around one — and don't return the week to a horizontally scrolling set of fixed-width columns.
- Don't use Space Grotesk for anything in the workspace other than a date that is itself the heading.
