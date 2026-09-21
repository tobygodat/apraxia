---
name: "apraxia"
description: "apraxia on the Toby Godat foundations: warm paper in two themes, Literata throughout, one green that only ever means here, and rules instead of boxes."
colors:
  ground: "#1b1a19"
  ground-raised: "#252422"
  text: "#e8e5df"
  muted: "#a39e96"
  faint: "#6f6b65"
  hairline: "#3b3936"
  hairline-strong: "#5a5752"
  outline: "#7d7972"
  selection: "#4a463f"
  accent: "#8fd18a"
  danger: "#e8907c"
  warning: "#e0b565"
  scrim: "rgba(0, 0, 0, 0.55)"
  light-ground: "#f4f1eb"
  light-ground-raised: "#fbf9f5"
  light-text: "#1b1a19"
  light-muted: "#6b665e"
  light-faint: "#9a948a"
  light-hairline: "#d9d3c9"
  light-hairline-strong: "#b8b1a5"
  light-outline: "#857f75"
  light-selection: "#e3dccf"
  light-accent: "#2e7d4f"
  light-danger: "#a63d2a"
  light-warning: "#8a5a00"
  light-scrim: "rgba(27, 26, 25, 0.32)"
  classic-primary: "#f0efed"
  classic-today: "#8fc981"
  classic-canvas: "#191919"
  classic-sidebar: "#202020"
  classic-hover: "#292929"
  classic-selected: "#2c2c2c"
  classic-line: "#303030"
  classic-muted: "#ada9a3"
  classic-field: "#111111"
  classic-dialog: "#181818"
  classic-raised: "#242424"
  classic-error: "#ffb4b4"
  classic-overdue: "#ddb1a4"
typography:
  display:
    fontFamily: "Literata, \"Iowan Old Style\", \"Palatino Linotype\", Palatino, \"Book Antiqua\", Georgia, \"Times New Roman\", serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Literata, \"Iowan Old Style\", \"Palatino Linotype\", Palatino, \"Book Antiqua\", Georgia, \"Times New Roman\", serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.005em"
  heading:
    fontFamily: "Literata, \"Iowan Old Style\", \"Palatino Linotype\", Palatino, \"Book Antiqua\", Georgia, \"Times New Roman\", serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Literata, \"Iowan Old Style\", \"Palatino Linotype\", Palatino, \"Book Antiqua\", Georgia, \"Times New Roman\", serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.6
  small:
    fontFamily: "Literata, \"Iowan Old Style\", \"Palatino Linotype\", Palatino, \"Book Antiqua\", Georgia, \"Times New Roman\", serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  fine:
    fontFamily: "Literata, \"Iowan Old Style\", \"Palatino Linotype\", Palatino, \"Book Antiqua\", Georgia, \"Times New Roman\", serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: "Literata, \"Iowan Old Style\", \"Palatino Linotype\", Palatino, \"Book Antiqua\", Georgia, \"Times New Roman\", serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
    fontStyle: "italic"
  classic-headline:
    fontFamily: "Georgia, \"Times New Roman\", serif"
    fontSize: "38px"
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: "-1px"
  classic-section-heading:
    fontFamily: "Georgia, \"Times New Roman\", serif"
    fontSize: "26px"
    fontWeight: 400
    letterSpacing: "-0.01em"
  classic-body:
    fontFamily: "\"Segoe UI\", system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  classic-label:
    fontFamily: "\"Segoe UI\", system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  classic-dialog-action:
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
  radius-sm: "2px"
  radius: "6px"
  classic-compact: "4px"
  classic-navigation: "5px"
  classic-collection: "7px"
  classic-field: "8px"
  classic-toast: "10px"
  classic-dialog: "14px"
  classic-pill: "999px"
spacing:
  space-xs: "4px"
  space-8: "8px"
  space-sm: "12px"
  space-md: "16px"
  space-24: "24px"
  space-lg: "40px"
  space-bottom: "56px"
  space-top: "64px"
  gutter: "20px"
  sidebar: "208px"
  measure: "600px"
  measure-wide: "960px"
  size-control: "36px"
  size-hit: "44px"
  size-menu-row: "34px"
  size-table-row: "48px"
  width-menu: "260px"
  width-toast: "360px"
  width-alert: "440px"
  width-dialog: "512px"
  width-command: "560px"
  distance-micro: "4px"
  distance-base: "8px"
components:
  action-word:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.small}"
    textDecoration: "underline 1px {colors.accent}"
    textUnderlineOffset: "0.2em"
  action-word-completing:
    textColor: "{colors.text}"
    fontWeight: 600
  action-word-quiet:
    textColor: "{colors.muted}"
    textDecoration: "none"
  action-word-danger:
    textColor: "{colors.danger}"
  row:
    backgroundColor: "transparent"
    typography: "{typography.body}"
    padding: "{spacing.space-sm} 0"
    borderBottom: "1px solid {colors.hairline}"
  row-meta:
    textColor: "{colors.muted}"
    typography: "{typography.fine}"
    fontFeature: "tabular-nums"
  field:
    backgroundColor: "{colors.ground-raised}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    border: "1px solid {colors.outline}"
    rounded: "{rounded.radius}"
    padding: "{spacing.space-8} {spacing.space-sm}"
  checkbox:
    backgroundColor: "{colors.ground-raised}"
    border: "1px solid {colors.outline}"
    rounded: "{rounded.radius-sm}"
    size: "18px"
    checkColor: "{colors.accent}"
  navigation:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.body}"
    padding: "{spacing.space-8} 0"
  navigation-current:
    textColor: "{colors.text}"
    borderBottom: "2px solid {colors.accent}"
  button-primary:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    fontWeight: 600
    border: "1px solid {colors.accent}"
    rounded: "{rounded.radius}"
    height: "{spacing.size-control}"
  button-standalone:
    border: "1px solid {colors.outline}"
  dialog:
    backgroundColor: "{colors.ground-raised}"
    border: "1px solid {colors.hairline-strong}"
    rounded: "{rounded.radius}"
    padding: "{spacing.space-24}"
    maxWidth: "{spacing.width-dialog}"
  menu-row:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    height: "{spacing.size-menu-row}"
    padding: "3px {spacing.space-sm}"
  menu-row-highlighted:
    backgroundColor: "{colors.selection}"
  command:
    backgroundColor: "{colors.ground-raised}"
    border: "1px solid {colors.hairline-strong}"
    rounded: "{rounded.radius}"
    maxWidth: "{spacing.width-command}"
  icon:
    size: "18px"
    viewBox: "24"
    strokeWidth: "1.5"
    fill: "none"
    color: "currentColor"
  event-rule:
    backgroundColor: "{colors.ground-raised}"
    typography: "{typography.fine}"
    border: "1px solid {colors.hairline}"
    borderLeft: "2px solid {colors.outline}"
    padding: "0 0 0 {spacing.space-8}"
    fontFeature: "tabular-nums"
  focus-ring:
    outline: "2px solid {colors.accent}"
    outlineOffset: "3px"
    rounded: "{rounded.radius-sm}"
---

# Design System: apraxia

## Overview

**Creative North Star: "It reads like a page."**

apraxia is set type on warm paper. A screen is a page of words with rules
between them, not a dashboard of widgets. Hierarchy comes from weight, from
`muted`, and from the space before a thing — never from a box around it.

apraxia does not have a design system of its own. It takes the **Toby Godat
design system** whole and brings its own structure: the tokens, both themes,
Literata, the seven text styles, the spacing scale, the `sizing` and `timing`
tokens, the two radii, the states, and the rule that a word comes before an
icon are fixed here. What apraxia
decides for itself is hierarchy, navigation, density and its own surfaces.

The system's own source is at
<https://claude.ai/artifact/XoJ7FUqR1v7ZKfTDkpfBV3>; the apraxia Paper mock, the
authority for the surfaces the reference pages don't cover, is at
<https://claude.ai/artifact/5p3JsHY2KVmYnHffzYcR6g>; the redesign reference
pages for home and tasks are at
<https://claude.ai/artifact/CopJWGga2itvMMmfbk4mVv>. Where this document and the
system disagree, the system wins and this document is wrong. Where this
document records an apraxia decision the system leaves open, it is the
authority.

This document follows the system's **draft 3** (20 September 2026), which
removed the Still principle and put a Motion section in its place, added
principles 6 to 10, the Density section, the `sizing` and `timing` token
families, the highlighted and busy states, and `Button`, `Field`, `Menu`,
`Dialog`, `Table`, `Toast`, `Empty`, `Motion`, `Command` and `CalendarEvent`.

**The ten principles, in the system's words:**

1. **It reads like a page.** If a plain sentence or a plain line of words will
   do, use it.
2. **One green, and it means "here".** `accent` marks what you can act on and
   where you are. Never decoration, never a status, never a filled area.
3. **Rules, not boxes.** Space separates first, a 1px `hairline` second.
   Nothing on the page is wrapped in a card.
4. **Words first; an icon never stands alone.** A control may carry a small
   line icon beside its word, never instead of it. The one exception is a
   chevron that steps backward or forward.
5. **Two themes, same page.** Dark is the default; light is the same thing on
   light paper. Every colour decision is made in both.
6. **One border per group.** The primary action carries the border; its
   companions are words. Hierarchy comes from how many things are boxed.
7. **Looks small, touches big.** Controls are `size-control` (36px) to the eye
   and `size-hit` (44px) to a finger. The hit area grows on coarse pointers;
   the drawing does not.
8. **Hover is weaker than selected.** Hover turns a word `accent`. `selection`
   as a background means chosen, or the row a menu will act on.
9. **State lives in the markup.** `aria-invalid`, `aria-selected`,
   `aria-pressed`, `aria-busy`, `aria-sort` and `disabled` drive the look. No
   state exists only as a class.
10. **Layout holds when state changes.** A loading button keeps its width. A
    sentence replaces a sentence. Room is reserved before the content arrives,
    so nothing jumps.

## What ships today

This document is the direction for every new surface and every change to an
existing one. It is not yet a record of what is deployed, and the gap is
deliberate.

- The workspace still ships the **classic** theme: charcoal surfaces, Georgia
  page headings, Segoe UI controls, bordered day columns. It is the default
  preset and stays pixel-identical while Paper is built beside it.
- The **Ledger** board theme is gone: the Tasks board now has one look in
  classic, and the per-page theme switch in Settings went with it. Ledger's
  vocabulary is not lost — the ruled row, the 2px rule that marks now, the
  struck-through finished item and the "12 days late" count in `warning` were
  drawn from it into the foundations in September 2026, and Paper inherits all
  four.
- **Paper** and **Paper light** are presets in the same
  `apraxia:workspace-preferences` store the board theme used, widened from the
  board to the whole app. Their foundations — both token sets, the document
  base and the shared primitives — live in `frontend/src/paper.css`. The
  Appearance page offers them, and `/qa/workspace.html?theme=paper` opens the
  fixture in one.
- The classic palette, type and radii stay in the frontmatter above, prefixed
  `classic-`, for as long as the classic stylesheets ship. They are frozen: do
  not extend them, do not reach for them in new work, and do not mix the two
  vocabularies on one surface.

- **Draft 3 is only partly built.** Paper carries the `timing` and `sizing`
  tokens, the motion in **Motion** below (colour, the line under the current
  word, surfaces arriving), the command palette's behaviour, the
  `.paper-button` primitive, and the `Button`: the bordered primary in the task
  and collection dialogs and on every page's and section's "add". Not built yet: `size-control`
  and `size-hit` on fields and words, the busy word holding its resting width,
  the 512px dialog with its header, panel and footer (Paper dialogs are still
  520px on a `hairline`), surfaces leaving, toasts, and the palette's
  borderless input and `do` group.

A surface being rebuilt in Paper is rebuilt whole. Half a screen in Literata
over half a screen in Segoe UI is worse than either.

## Voice

Copy is part of the design here, not a layer over it.

- Plain and direct, friendly without selling. Interface words are **lowercase**:
  tabs, section headings, action words, footers, captions — "add project",
  "saved on this device only", "nothing here yet."
- Proper nouns and user content keep their own case: "MATH3012", "Problem set
  3", "Google Drive", "apraxia".
- Join items on a line with a spaced middle dot, ` · `. Ranges take an en dash.
  Keep a month and its year together with a non-breaking space.
- State facts with their numbers: "5 open · 1 note", "12 days late". No
  adjective does a number's job.
- Errors say what happened and what to do, in a sentence, without blame and
  without "oops": "September has 30 days. Pick a date on or before sep 30."
- Section headings carry a green `// ` prefix. That comment mark is the only
  nod to code — no terminal prompts, file paths or monospace styling.
- No emoji.

## Colors

Two surfaces, three inks, three lines, one green, two for trouble.

### Surfaces

- **`ground`**: the screen. Most of apraxia is this and nothing else — every
  list, board, table and page region sits directly on it.
- **`ground-raised`**: the one other surface, for what floats over the page
  (menus, popovers, dialogs, the undo toast) and for the inside of form fields.
  It always carries a 1px border and never a shadow. Content laid out *in* the
  page never uses it.

### Inks

- **`text`**: everything that matters — prose, row names, field values, the
  current section, the title.
- **`muted`**: what supports it — labels, dates, metadata, help text, captions,
  unselected tabs, placeholders, and the name of a finished item.
- **`faint`**: disabled words and controls only. Deliberately below reading
  contrast; never for anything a person must read or press.

### Lines

- **`hairline`**: the 1px rule that separates — between rows, under a tab row,
  beside the sidebar, around a raised surface.
- **`hairline-strong`**: the same where it must show on `ground-raised`, and the
  scrollbar thumb.
- **`outline`**: the 1px border of anything you type into or tick. At 3:1 on
  both surfaces in both themes, so a control is findable by its border alone.

`hairline` and `hairline-strong` are decorative and carry no meaning on their
own: never let a rule be the only sign that something is a control.

### Accent

**`accent`** is the one green, and it means *you can act here* or *you are
here*: a link's underline, the hover colour of a word, the 2px marker under the
current section or tab, the `// ` before a heading, the focus ring, the tick in
a checkbox, and **now** — the 2px rule across the current day's column and the
current-time line in the calendar. Lines and words only.

**The One Green Rule.** `accent` is never a fill, never a background, never a
status, never a badge, and never decoration. Nothing is "highlighted in green"
because it is important; it is green because you are there or you can act
there. An icon takes `accent` only when its word does.

### Trouble

- **`danger`**: errors and destructive actions — the sentence under a field,
  that field's border, the word "delete". A warm brick, not a signal red.
- **`warning`**: attention without failure — unsaved changes, a degraded
  provider, and **late**: the words "past due wed, sep 16" or "12 days late"
  inside an otherwise `muted` line. The rest of the line stays `muted`.

**There is no success colour.** Success is said in `text`, in words, and then
gets out of the way. A finished task is `muted` with a line through it; its
tick is `accent` because ticking it was the action, not because finishing is
green.

### Selection and scrim

`selection` backs selected text and the highlighted row of a menu or list under
the pointer or keyboard. `scrim` sits behind a modal dialog and nowhere else.

### Calendar colours

Google calendars are colour-coded upstream, and losing that loses information
the person put there. **An event is raised off the ruled grid, and the 2px rule
at its left carries the calendar's own colour.** This is the recorded exception
to the one-hue rule, and the only one.

- The rule is 2px and at the event's left edge. The event is opaque
  `ground-raised` inside a 1px `hairline`, so the hour rules stop at its edge.
  The fill is neutral by default. **Appearance** offers the other choice,
  `tinted`: the calendar's colour mixed 16% into `ground`, still opaque, with
  no hairline because the tint is its own edge. It is a preference, not the
  default, because seven tints across a warm page fight the one-hue rule.
- `calendarColors.ts` keeps preserving valid Google colours and supplying stable
  fallbacks. Its luminance-based text choice is not needed on a neutral fill —
  every event's name is `text` at 600, a shift included, and its time and place
  are `muted`.
- Calendar fallback colours are data, not a brand palette. They appear on
  calendar event rules and nowhere else.

### Themes

Set the theme with `data-theme` on the root element. apraxia carries the
preset name there rather than the system's bare `dark|light`, because classic
is a third value: `classic`, `paper` (dark) and `paper-light`. A Paper rule
scopes itself with `[data-theme^="paper"]`, which matches both and never
matches classic. Every colour decision is made
in both themes; a value that only works in one is not finished.

Light `accent` (`#2e7d4f`) measures about 4.48:1 on light `ground` when it
colours a hovered word — a hair under 4.5:1, kept exact from the source. It is
the one documented exception and is not licence to add others.

## Typography

**Literata throughout**, self-hosted in `frontend/public/fonts/` beside the
sign-in faces and falling back through Iowan Old Style, Palatino and Georgia. One family: no sans
for the interface, no mono for data, no second face for dense screens.

Seven styles, weights 400 and 600 only:

| style | size | use |
| --- | --- | --- |
| `display` | 24px/1.3, 600 | once per screen: the page's name |
| `title` | 20px/1.3, 600 | a dialog's title, the product name in the sidebar, a major region |
| `heading` | 17px/1.3, 600 | a section heading, with its `// ` — body size, set apart by weight and the green alone |
| `body` | 17px/1.6, 400 | the default for everything: prose, row names, field values, tabs, action words |
| `small` | 15px/1.6, 400 | supporting lines: dates, metadata, help and error text, footers, quiet actions |
| `fine` | 13px/1.5, 400 | the floor, dense screens only: table headers, row metadata, timestamps, shortcut keys |
| `caption` | 15px/1.6, 400 italic | a line under a figure or an aside. The only italic |

**The Floor Rule.** `fine` is the smallest type in apraxia. Nothing goes below
13px, and nothing that must be read to use a screen is set in it. A screen that
needs a smaller step needs less on it.

Turn on kerning and ligatures. Use tabular figures wherever numbers line up —
due dates, times, counts, the week range, a table's date column.
`text-wrap: balance` on headings, `pretty` on paragraphs.

**Hierarchy comes from weight, `muted`, and the space before a thing.** Size is
the last lever, not the first: a section heading is body size, and it reads as a
heading because of its weight and its green `// `.

The sign-in screens keep their Space Grotesk and JetBrains Mono treatment for
now; they are outside the workspace shell and are the last surface to convert.
They are recorded in the frontmatter so the bundled faces stay accounted for.

## Layout

The scale is **4 · 8 · 12 · 16 · 24 · 40**, with 56 and 64 for the bottom and
top of a screen. Closer means related: 4 within a pair, 12 to 16 within a
group, 24 between groups, 40 between regions.

- Reading columns and forms sit in `measure` (600px); paragraphs cap at 62ch
  inside it.
- Working screens widen to `measure-wide` (960px), and prose inside them still
  obeys `measure`.
- Every screen keeps at least `gutter` (20px) at its sides.
- At 560px and below, `space-lg` becomes 32px and the top and bottom padding
  become 40px. At 760px and below the sidebar becomes a block above the content.

### The app shell

apraxia has several sections, so it uses the system's `AppShell`: a `sidebar`
(208px) of words on the left, divided from a fluid main area by a `hairline`.
Both sit on `ground`; panes are never told apart by different backgrounds.

Top to bottom: the product name in `title` with its mark; **search**, set apart
with `space-lg` above and below and its shortcut in `fine` at the right; the
sections, `space-8` of padding each; then, above a `hairline`, the actions that
belong to the person rather than a section — add and account.

Every row is an icon and a word, `muted` until hovered. The current section is
`text` with a 2px `accent` line under its **word**, not under its row and not
behind it.

The main area takes `space-lg` of padding and keeps to `measure-wide`, except
for a grid that genuinely needs the room — the seven-day week, a wide table —
which may run its full width.

## Elevation & Depth

There is no elevation. **No shadows and no gradients**: a thing that floats is
`ground-raised` with a 1px border, `radius` corners and `space-md` to
`space-24` of padding, and that is the whole vocabulary. 1px lines only.
`radius` (6px) for images, fields and raised surfaces; `radius-sm` (2px) for
focus outlines and checkboxes. Nothing is rounder — **no pills**, and no circle
except a radio.

## Density

What a control looks like and what a finger can hit are separate numbers.
Everything typed into or pressed is `size-control` (36px) tall, so a field and
a button on one row line up; on coarse pointers each gets an invisible
`size-hit` (44px) area and the drawing does not change. A menu row is
`size-menu-row` (34px), a table row `size-table-row` (48px) under a 36px header
in `fine`. Widths are tokens too: `width-menu` (260px), `width-toast` (360px),
`width-alert` (440px), `width-dialog` (512px), `width-command` (560px).

## Motion

Quiet and short. Motion says where something came from or that something
changed; it never performs. The foundations dropped their Still principle in
draft 3 (20 September 2026) and this section took its place.

- Arriving takes `duration-fast` (250ms); leaving takes `duration-quick`
  (150ms); a toast leaving by itself takes `duration-medium` (350ms). One
  curve, `ease-smooth-out`, `cubic-bezier(0.22, 1, 0.36, 1)`.
- Animate opacity and position only, listed by name. Never `transition: all`.
  Layout does not animate: the rail changes width at once, and a row never
  grows under the pointer.
- A surface anchored to a trigger arrives from that trigger, `distance-micro`
  (4px): a menu under its control from above, the account menu over its
  trigger from below, the notice from the top edge. A centred one (a dialog,
  search) arrives from just below centre, `distance-base` (8px), while its
  `scrim` fades in. Surfaces fade and shift; they do not scale.
- Hover, focus and selection change colour over `duration-quick` and move
  nothing. The 2px `accent` line under a tab or the current sidebar word draws
  in over `duration-fast`. It does not slide between words and it does not
  follow the pointer: the green line only ever sits where you are.
- No bounce, stagger, blur, shimmer or parallax. Loading is still the word
  "loading…", and the cold-load rule across the top stays still.
- Every duration is multiplied by `motion-scale`. It is 1, and 0 under
  `prefers-reduced-motion`, so all motion stops from one place. Never write a
  duration as a bare number.

In `frontend/src/paper.css` the duration tokens already carry the multiplier,
so a sheet writes `var(--duration-quick)` and nothing else. Reach for
`var(--transition-state)` for colour and `var(--arrive-below)`,
`var(--arrive-above)`, `var(--arrive-centre)` and `var(--arrive-scrim)` for a
surface; the keyframes move `translate`, so a surface that centres itself with
`transform` keeps its place. Surfaces do not yet animate on leaving: they
unmount at once, which `duration-quick` will replace when a surface is next
rebuilt.

## States

- **Hover:** the word turns `accent` over `duration-quick`. In a table, the
  row's name turns `accent`; the row takes no background. Nothing moves, grows
  or lifts.
- **Highlighted:** the row of a menu or command list under the pointer or the
  keyboard takes `selection` (`data-highlighted`).
- **Focus:** a solid 2px `accent` outline, offset 3px, `radius-sm` corners. At
  least 3:1 on both surfaces in both themes. Never removed.
- **Selected / current:** `text`, with a 2px `accent` line under it. A
  selected table row takes `selection` (`aria-selected`).
- **Now:** the current day or time takes a 2px `accent` rule across its whole
  column or row, and its label is `text` at 600. **No "today" tag beside it.**
- **Done:** the name is `muted` with a line through it; the tick in its checkbox
  is `accent`. Nothing turns green.
- **Late:** the words that say so are `warning`; the rest of the line stays
  `muted`.
- **Disabled:** `faint`, no underline, no hover.
- **Busy:** the button's word becomes "saving…" in `muted` inside the width of
  its resting word (`aria-busy`); the border rests at `hairline-strong`.
  Nothing resizes.
- **Error:** the field's border and the sentence under it in `danger`; the
  value the person typed stays in `text`.
- **Loading and empty:** a `muted` sentence where the content will be
  ("loading…", "nothing here yet."). **No spinners, no skeletons, no
  illustrations.**

## Iconography and imagery

Words come first, and an icon never stands alone. Any control may carry an icon
beside its word: an 18px line drawing on a 24px grid, 1.5px stroke, round caps
and joins, no fill, drawn in `currentColor` so it takes the ink of its word and
turns `accent` with it on hover. Icon and word sit `space-sm` apart, and the
icon is hidden from assistive technology because the word already says it.

The one icon allowed alone is a chevron that steps backward or forward —
previous and next week — and it carries an `aria-label`. Icons never replace a
word, never carry a status, never take a colour of their own, and are never
filled. No icon fonts, no emoji.

The favicon is one lowercase serif letter on `ground`. There is no imagery: the
Home cover was removed, and the page is type on a ruled ground throughout.

## Components

### Actions

**An action is an underlined word, like a link — and one action per group may
carry a border.** Hierarchy comes from how many things are boxed, so a group
never has two.

- An ordinary action is `body` or `small` in `text`, underlined 1px in `accent`
  with a 0.2em underline offset; it turns `accent` on hover.
- A quiet action is the same word in `muted` with no underline: "open",
  "cancel", "edit class".
- **The one action that completes a screen or a dialog** — "add assignment",
  "save task", "add project" — is a `Button`: `size-control` tall, a 1px
  `accent` border, `radius` corners, the word at 600. One per screen region or
  dialog. Nothing is ever filled with `accent`. In practice that is the "add"
  in a page header or a section header: "add project", "add event", "add task",
  "add assignment". A header's "edit" beside it stays quiet, and an "add" that
  repeats down a list or across columns ("add task" under each day, "add step")
  stays a word, because a row of borders is a toolbar.
- A standalone action with no companions — "new task" in a header — may take
  the same box with an `outline` border.
- A destructive action is its word in `danger`: "delete", "remove". It takes a
  border only as the confirm of an alert dialog.
- Hover turns the word `accent` over `duration-quick`; the border does not
  change. Busy swaps the word for "saving…" without changing the width.

Sizes, pills, filled backgrounds, icon-only buttons and toolbars of bordered
rectangles all leave with the classic theme.

### Fields

A field is `size-control` tall, `ground-raised` inside, a 1px `outline` border,
`radius` corners, `body` type, `space-8`/`space-sm` padding, and the standard
focus ring. Its
label sits above it in `small` `muted`, `space-xs` away. Help and error text sit
below it in `small`. An invalid field takes a `danger` border and a `danger`
sentence; the value stays in `text`. Errors appear when the field is left and
clear as soon as the value is valid. Required is the default; the exception is
marked "· optional" in `faint` after the label, never with an asterisk. A
select is a field-shaped button with a `muted` chevron whose list is a menu.
There is no switch: a checkbox says the same thing without a pill.

A checkbox is 18px, `ground-raised`, a 1px `outline` border, `radius-sm`
corners, and an `accent` tick. A radio is the same at 999px with an `accent`
dot — the one circle in the system.

### Rows and lists

A list is a stack of ruled lines, opened by a `hairline` above the first row
and closed by one under the last. A row is `space-sm` of vertical padding, its
name in `body`, its supporting line in `fine` or `small` `muted` with tabular
figures, and its actions as words at the row's end, `space-md` apart. No hover
raise, no card, no border on three sides.

Everything that was a badge or a pill becomes language in that muted line:
"someday · A small trip, with room to wander.", "added sep 15 · pdf · 2.1 MB",
"homework". A status is a word people read, not chrome they decode.

### Tables

A table stays a list of ruled lines: headers in `fine` `muted` at weight 400
over a `hairline`, cells with `space-sm` vertical padding and a `hairline`
under each row, no vertical cell borders, no zebra striping, and the last
column right-aligned. A row's delete is the word "delete" in `danger`, not a
trash icon.

A sortable header is a button; the sorted column sets `aria-sort` and its word
turns `text` over the 2px `accent` line with a small chevron for direction.
Hover turns the row's name `accent` and gives the row no background, because
hover must be weaker than selected; a selected row (`aria-selected`) takes
`selection`, and the actions on the selection are words above the table.

### A row of words you choose one of

Filters, tabs and segmented choices are all the same thing: a `small` `muted`
row of words with `space-md` between them, the chosen one in `text` over a 2px
`accent` line. The group is labelled by a plain word beside it — "status".

Each word is a `<button aria-pressed>` and exactly one is pressed. Two to five
options, the unfiltered one first; more than five, or options that change with
the data, is a select. A filter narrows one list and sits in a line of facts
with no rule under it; tabs swap whole sections and sit on a `hairline`. Either
way the line under the chosen word draws in (see **Motion**) and never slides.

### Dialogs

A dialog is `ground-raised`, a 1px `hairline-strong` border, `radius` corners,
`space-24` of padding, `width-dialog` (512px) wide, over a `scrim`. No shadow.

- Three parts: a header (the title in `title`, an optional sentence in `small`
  `muted`), a panel, and a footer above a `hairline-strong` rule. Only the
  panel scrolls. Fields are `space-24` apart.
- The footer holds the one `Button` at the right and words to its left. There
  is no close icon: "cancel" is the close, and so are esc and the scrim.
- An **alert dialog** (`width-alert`, `role="alertdialog"`) asks a question: a
  title, one sentence of consequence, two actions. The scrim does not dismiss
  it, focus starts on the safe word, and its confirm is the only bordered
  `danger` button in the system.
- At 560px and below it attaches to the bottom at full width and the footer
  stacks with the primary on top.
- It arrives from just below centre while the scrim fades. One dialog at a
  time; a dialog never opens a dialog, except to confirm with an alert. Focus
  is trapped inside and returns to the trigger on close.

### Menus

A menu floats from its trigger: `ground-raised`, a 1px `hairline-strong`
border, `radius` corners, at least `width-menu` wide. Rows are words,
`size-menu-row` tall, with a shortcut at the right in `fine` `muted`. The row
under the pointer or keyboard takes `selection`; the current choice carries an
`accent` tick, and if any row can be ticked every row reserves the column.
Groups get a `fine` `muted` label; a destructive row goes last, after a rule.
Arrows move, enter chooses, esc closes and returns focus.

### The command palette

Search and do, from the keyboard: `width-command`, `ground-raised`, over a
`scrim`, in the upper third of the screen, opened from the sidebar's search row
and by ctrl/cmd + K.

- Rows come in groups with a `fine` `muted` label: **go to** lists the pages,
  all of them before anything is typed and the matching ones after;
  **records** lists what the workspace search finds. The left column says what
  a row is — "page", "task", "note" — in `fine` `muted`.
- **The first row is highlighted, so enter always does something.** Arrows move
  the highlight and wrap; focus never leaves the input; the pointer moves the
  same highlight rather than a second one.
- The footer says the keys in words, in `fine`: "enter to open · arrows to move
  · esc to close". No key glyphs standing alone.
- Nothing found is a sentence. It arrives from just below centre and returns
  focus on close.
- A page's name is an interface word and is lowercase; a record's title keeps
  its own case.

### Toasts

One sentence that reports what just happened, bottom right, and then leaves:
`ground-raised`, a 1px `hairline-strong` border, `width-toast`, `space-24` from
the edges, at most one action word ("undo"). Success leaves after 5 seconds; a
warning or an error starts with its words in `warning` or `danger` and stays
until dismissed. The same event updates its toast in place; at most three show.
`role="status"` for what passes, `role="alert"` for trouble, and never the only
place a field's error is shown.

### Calendar

The time grid stays neutral. An event is a name in `text` at 600 with its time
and place in `muted` on the line below, both in `fine` with tabular figures, on
opaque `ground-raised` inside a `hairline`, with a 2px rule at its left carrying
its calendar's colour (see **Calendar colours**). The current-time line is a 2px
`accent` rule. The fill is neutral, so nothing needs to choose black or white
text to survive its own background, and a dense day stops being a wall of
colour.

The system's own `CalendarEvent` (draft 3) draws the rule in `outline` on
`ground` with no colour per calendar. apraxia keeps its recorded exception
above — raised, with the calendar's colour on the rule — and takes the rest:
**selected** (`aria-pressed`) turns the rule `accent` and the name 600,
**past** is a `muted` name with no line through it, **tentative** is a dashed
rule, and an event shorter than 50 minutes puts name and time on one line
joined with ` · `.

### The week

The Tasks week is a grid that needs the room, so it runs the full width of the
main area. Each day is a column of ruled rows under its date; the current day's
column carries a 2px `accent` rule across its head and its date is `text` at
600. There is no "today" tag, no count badge, no border around a column, no
background behind one, and no horizontal scroll.

The ruled ground stays: a column keeps ruling through the space it has not
filled yet, so an empty day is a ruled column rather than a blank one, and the
row that has not been written yet is a rule with a `muted` label on it, not a
button.

### Appearance

Appearance is a page of its own, reached from the account menu between
settings and sign out. Each group is a list of choices — a radio, its name in
`body` and its description in `small` `muted`, ruled like any other list and
capped at `measure` — with "These choices are saved on this device only." in
`muted` under the page's name.

- **theme**: **classic**, **paper**, **paper light** and **match device**.
  Classic is the default. Match device is not a fourth look: it is Paper,
  following the device between the dark page and the light one, so `data-theme`
  still only carries a real preset.
- **sidebar**: **words** or **icons only**, the same preference the sidebar's
  own chevron sets.

There is no text-size choice. Scaling the root overflows the grids that size
against the viewport, and browser zoom already does the job properly.

## Do's and Don'ts

### Do

- Do take the foundations whole: the tokens, both themes, Literata, the seven
  styles, the spacing scale, the `sizing` and `timing` tokens, the two radii
  and the states are fixed.
- Do let state live in the markup (`aria-pressed`, `aria-selected`,
  `aria-busy`, `data-highlighted`) and style from it.
- Do reserve room before content arrives, so nothing jumps when it does.
- Do make every colour decision in both themes before calling a surface done.
- Do say it with type, space and a rule first. Most cards become a ruled row;
  most badges become a `muted` word; most icons become the word they stood for.
- Do keep `accent` to lines and words that mean "here" or "you can act here".
- Do keep interface words lowercase and let user content keep its own case.
- Do give every control a word, and let an icon sit beside it rather than
  instead of it.
- Do use tabular figures wherever numbers line up.
- Do convert a surface whole, and record a new value as a token in the design
  system before using it here.

### Don't

- Don't add a hue. apraxia does not get its own accent, and there is no success
  colour.
- Don't fill anything with `accent`, and don't use it for a status or a badge.
- Don't put a card, a shadow, a gradient or a pill on the page. If it floats it
  is `ground-raised` with a 1px border; if it doesn't float it sits on `ground`
  between rules.
- Don't perform. No bounce, stagger, blur, shimmer, parallax, hover raise or
  scale, no `transition: all`, and no duration written as a bare number. The
  green line never slides or follows the pointer.
- Don't put two borders in one group.
- Don't give a hovered row a background; `selection` means chosen or
  highlighted.
- Don't go below `fine`, and don't invent a step between the seven.
- Don't mix the classic vocabulary with Paper on one surface, and don't extend
  the frozen `classic-` tokens.
- Don't leave an icon standing alone, except a stepping chevron with its label.
- Don't reach for a spinner, a skeleton or an empty-state illustration; a muted
  sentence does the job.
- Don't mark today with a tag, a badge or a count — the 2px rule and the
  weight say it.
