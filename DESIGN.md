---
name: "orbitOS"
description: "A personal workspace with charcoal surfaces, serif page headings, and restrained controls."
colors:
  primary: "#f0efed"
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
  dialog: "14px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  control-gap: "12px"
  md: "16px"
  lg: "24px"
  page-top: "36px"
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
    padding: "7px 0"
---

# Design System: orbitOS

## Overview

**Creative North Star: "The Quiet Desk"**

orbitOS uses dark neutral surfaces, warm light text, and familiar document typography. Georgia page headings give the workspace a personal character; Segoe UI keeps navigation, forms, and dense task information practical.

Hierarchy comes from spacing, fine rules, and small changes in surface tone. Calendar fills and status colors carry information; the surrounding interface stays restrained.

The user-confirmed descriptive direction is “The Quiet Desk — calm and personal.”

**Key Characteristics:**

- Charcoal surfaces with warm light text.
- Serif page headings and compact sans-serif controls.
- Fine dividers, flat rows, and quiet interaction states.

This document captures the local cloud implementation on 2026-09-13, including existing uncommitted work. It does not establish what is deployed. The source of visual evidence is `frontend/src/`, especially `components/app-shell/CloudAppShell.css`, `apps/workspace.css`, `features/calendar/calendar.css`, `features/todos/`, and `features/collections/collections.css`. The experiment under `frontend/qa/redesign/` has its own scope.

Frontmatter records reusable observed values; most are still CSS literals or component-scoped properties, not centralized application tokens. It follows the [DESIGN.md format](https://raw.githubusercontent.com/google-labs-code/design.md/main/docs/spec.md). The sidecar contains previews and metadata, not an application stylesheet.

## Colors

The palette is neutral charcoal, with warmth supplied by light text and muted grey labels.

### Primary

- **Warm Paper** (`primary`): main text, keyboard focus, selected dates, and primary save actions. Primary buttons use dark dialog-colored text.

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
- Component-scoped translucent whites remain intentional: task-dialog text, muted text, and borders use their local variables. Do not silently replace these with shell tokens.

**The Semantic Color Rule.** Keep the interface neutral. Calendar fills identify calendars; warm error and overdue colors communicate status.

## Typography

Page headings pair Georgia with a Times New Roman/serif fallback; body text and controls use Segoe UI, system-ui, sans-serif. The hierarchy is role-based rather than a mathematical scale.

Two families are actually bundled. `frontend/public/fonts/fonts.css` is linked from `index.html` and self-hosts Space Grotesk (400/500/700) and JetBrains Mono (400/500). They are used by the sign-in and cloud-ready screens in `index.css` and by the preserved legacy `orbit-shell` styles, not by the cloud workspace, which relies on the system Georgia and Segoe UI stacks above. Both sets are recorded in the frontmatter: workspace roles use the system stacks, `sign-in-headline` and `sign-in-eyebrow` use the bundled faces. The sign-in headline is a `clamp(30px, 5vw, 52px)` scale; the frontmatter records its upper bound.

- **Headline:** the frontmatter's shared page title treatment, applied to Tasks, collection pages, Classes, and Calendar settings.
- **Body:** compact task-row text. Collection titles use a slightly larger treatment (14px, weight 500); supporting descriptions use relaxed line height.
- **Navigation / Label:** familiar sans-serif controls. Smaller metadata varies by context (10–12px); these values document the current density.
- **Dialog:** titles use sans-serif (18–22px, weight 500); inputs are larger (15–16px) than their labels.
- **Home:** the visible title is optional. A plain title uses Georgia (38px); cover titles use a smaller treatment (32px, reducing to 27px below 900px). Do not force a heading into the hidden-title state.
- **Numbers:** calendar time labels and event times use tabular numerals. Uppercase weekday labels are local to the calendar.

**The Heading Rule.** Use the shared serif treatment for workspace page titles. Keep controls, metadata, and dialog titles in their existing sans-serif styles.

## Layout

The desktop shell has a sticky sidebar (200px) and a flexible content column, with a top header (62px). Shared page insets use `clamp(20px, 2.5vw, 36px)`; ordinary pages start 36px below their header. Spacing is not a strict single-unit grid: compact controls also use 5px, 7px, 9px, and 14px adjustments.

- At 1200px and below, the sidebar narrows to 174px.
- At 980px and below, it becomes a 64px icon rail; labels stay accessible.
- At 620px and below, navigation wraps into a horizontal header with visible labels, and the top content header becomes 54px tall.
- Home places a flexible weekly calendar beside a task column sized with `clamp(280px, 24vw, 340px)`. At 900px and below, the calendar and tasks stack; each retains an internal scrolling region.
- Collection pages are left-aligned within the shell and capped at 1120px. Text descriptions may use a 72ch reading width.
- Task dialogs cap at 580px and scroll when needed. Below 560px, detail fields become one column and the dialog sits near the bottom with reduced outer spacing.
- Classes uses a wider local layout (up to 1440px) and a notes split that stacks below 760px.

These are observed responsive rules, not a claim that every mobile flow has been validated. Home cover sizing and scrolling are controlled by its existing layout logic.

## Elevation & Depth

Persistent workspace content is mostly flat. The sidebar's lighter tone, section rules, and local hover fills provide separation. Floating surfaces use actual shadows:

- Account menu: `0 12px 32px #0005`.
- Workspace notice: `0 8px 24px #0006`.
- Workspace dialog: `0 20px 60px #0008`.
- Task dialog: `0 24px 70px rgba(0, 0, 0, 0.48)`.

**The Flat Workspace Rule.** Use tonal surfaces and rules for persistent content. Reserve substantial shadows for temporary menus, notices, and dialogs.

Navigation changes color and background over 140ms; task-dialog controls transition over 150ms. The task dialog enters over 180ms with a small upward movement and scale change. Preserve the existing reduced-motion overrides.

## Shapes

The system uses restrained rectangular geometry, fine borders, and modest corner rounding. Frontmatter names the observed corner values by component role rather than claiming a universal scale.

Compact calendar controls and checkboxes use the compact radius. Shell navigation and Add use the navigation radius; collection actions use the collection radius; editable fields use the field radius. Task dialogs are softer, with the dialog radius and pill-shaped action buttons. Workspace dialogs remain square; event dialogs have their own modest rounding. Avatars and the selected calendar date are circular.

## Components

### Buttons

Primary save actions pair Warm Paper with dark text and brighten to white on hover. The task-dialog variant has pill corners, a 42px minimum height, and compact labels. Collection primary actions use a 38px minimum height and modest corners instead.

The shell Add button is a transparent bordered rectangle with a 34px minimum height; hover lightens its background and border. Calendar toolbars use smaller controls. Preserve these contextual differences.

Focus is generally a light 2px outline with a 3px offset. Pending/disabled actions become translucent; preserve each component's native disabled or aria-disabled behavior.

### Inputs

Dark inset fields have visible borders, rounded corners, and comfortable inner padding. Collection and task-dialog fields have a 44px minimum height. Task-dialog borders strengthen on hover; invalid fields gain a rose border and accompanying error text. Keep labels and error messages connected to their controls.

### Navigation

A labeled icon sidebar anchors the desktop workspace. Active destinations receive a selected-charcoal fill and brighter text; hover uses a slightly quieter fill. Search appears above the destinations; the account control sits below them. Icons use the existing inline SVG vocabulary (24-unit viewBox, 1.5 stroke, rounded ends), usually rendered at 18px.

### Selection controls

The Today/Tomorrow switch is a compact pair of rectangular buttons, with a filled selected state and visible focus. There is no general-purpose chip/tag system in the cloud workspace: collection filters use selects, while task metadata remains text.

### Lists and containers

Collection entries and task-board “cards” are flat rows divided by thin rules. Task-board rows expose compact checkbox, text, metadata, and action areas; hover adds a raised-charcoal tone. Completion dims and strikes through task text. Keep long titles wrapping and metadata subordinate.

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

### Don't

- Don't treat the isolated QA redesign study or legacy orbit-shell styles as the cloud workspace design authority.
- Don't turn flat collection and task rows into elevated cards by default.
- Don't apply the dialog's pill buttons or larger radius to every toolbar.
- Don't interpret the documented desktop density as a verified mobile accessibility standard.
