---
version: 1
slug: "frontend-src-features-classes-drivenotes-tsx"
primary_target: "frontend/src/features/classes/DriveNotes.tsx"
related_targets: ["frontend/src/features/classes/drivePicker.css", "frontend/src/features/classes/googlePicker.ts", "frontend/src/features/classes/PdfReader.tsx"]
---

# Classes Drive source row

## Surface boundary

This is a bounded extension to the existing Classes notes reader. The compact
Google Drive source row sits immediately above the incumbent PDF reader and
keeps the reader as the visual and task anchor. The row is a quiet dark-shell
control, not a new page, dashboard, or Drive browser.

## Visual contract

- Use the incumbent `Segoe UI`, system sans-serif, 13px / 1.5 treatment.
- Keep the row light and horizontal: 12px inline gaps, 12px top and 18px
  bottom padding, a 20px muted source icon, a medium-weight “Google Drive”
  label, and a flexible muted state line.
- The primary action is the existing shell button with a 40px minimum height.
  Its label is “Open from Drive” when connected and “Connect Drive” when
  consent is required.
- Keep the secondary connection menu quiet: a 36px × 40px trigger, 4px
  corners, a dark panel, and one “Disconnect Drive” action.
- Keep feedback inline and short. Loading, selection, opening, connection,
  and disconnecting states occupy the existing state line; errors sit below
  the row with one recovery action.

## Interaction contract

The connected primary action opens Google’s native Picker, which owns file
search, previews, folder navigation, PDF filtering, selection, and cancellation.
Selecting a PDF streams it into the existing reader. Cancelling or dismissing
the Picker returns without changing the current document. A remembered class
folder may seed the Picker’s starting location; it never prevents opening Drive
when stale. The overflow menu exposes disconnect as the only secondary action.

## Responsive boundary

The implemented narrow-screen rule wraps the row, gives the state line a
calculated second-line basis, and lets the primary action expand beside the
source icon. This is recorded as code-defined behavior; no mobile visual QA is
claimed for this handoff because the viewport override was unavailable.

## Verification record

At 1646 × 804, simulated PDF selection independently verified the source-row
and reader handoff, with a reviewer ship verdict of no material defects. The
native Google UI and production OAuth/API-key configuration remain pending
production testing. The project test suite passed 1,936 tests.

## Guardrails

- Do preserve the incumbent reader and its current document when Picker
  selection is cancelled.
- Do keep Google-owned browsing inside Google’s native Picker.
- Don’t add Drive synchronization, background writes, or a second file browser
  to this surface.
- Don’t promote this row’s composition into a product-wide design system.
