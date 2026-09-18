---
version: 1
slug: "frontend-src-features-review-weeklyreviewpage-tsx"
primary_target: "frontend/src/features/review/WeeklyReviewPage.tsx"
related_targets: ["frontend/src/features/review/weeklyReview.css","frontend/src/features/review/weeklyReviewModel.ts"]
---

# Weekly review page (/review) surface brief

Scope: the read-only weekly review at `/review`, rendered by
`frontend/src/features/review/WeeklyReviewPage.tsx` and `weeklyReview.css` over
`weeklyReviewModel.ts`. Mode: Operate. The visitor closes out a week: what was
finished, what slipped, and what is coming, without changing anything.

Audience and job: the owner sitting down at the end of a week. Content comes
entirely from the existing workspace snapshot (`TodoService.loadWorkspace`):
`completed_at`, which nothing in the browser read before this page, plus due
dates, projects and classes. No schema change, no writes.

Constraints: week boundaries are Monday-to-Sunday in the profile timezone, the
same weeks the Tasks board navigates. Date-only due dates and completion
instants are never round-tripped through a machine-local `Date`. The page
mutates nothing, so it carries no checkboxes, no row actions and no undo.

Unresolved: whether the week should start Sunday, matching the Home calendar,
rather than Monday, matching the Tasks board (Monday shipped); whether Next
should also list unscheduled Inbox tasks (it does not).

## Direction contract

THESIS: A week is closed out on one ruled sheet with a standing in its margin.
The page refuses the dashboard arrangement this content always gets — three
equal cards of a heading, a count and a list, or a hero metric with supporting
stats. Where the Tasks board rules the week by day, the review rules it by
project and class: the day leaves the column heading, so what a column is
about becomes the heading.

OWN-WORLD: The incumbent Quiet Desk world, unchanged. Charcoal canvas
(#1a1a1a), warm paper text at 93% white, warm grey and faint white for
secondary marks, hairlines at 12% white, a 2px group rule at 30% white, and the
Inbox band's repeating 41px ruled ground under every band including an empty
one. Georgia 38px page title, Georgia 26px band headings, Segoe UI 13px entries
with 11px metadata separated by a faint middle dot. Overdue Clay (#ddb1a4) on a
slipped due date is the page's only color; Today Periwinkle stays on the Tasks
board and is not borrowed here. No cards, no boxes, no counts in pills.

STORY: The visitor reads the margin first and knows the week in three numbers,
then drops into Finished, Slipped and Next in that order. Inside each band the
projects and classes are ruled columns, so it is immediately clear which
project carried the week and which class is the one leaking work. A group
heading is a link, so a band answers "what slipped in MATH3012" and then opens
it.

FIRST VIEWPORT: Title and week range at the left, prev / This week / next at
the right in the Tasks board's 44px hairline controls. Beneath, a two-column
sheet: a sticky margin of three ruled tally rows (label left, count right in
tabular numerals, each an anchor to its band) and a wide body of three bands.
Each band is a Georgia heading with a subordinate caption naming its count and
date range, then its groups flowing across auto-fill columns of at least 250px
with 28px gutters, each group a 13px heading over a 2px rule with its count at
the right, then 40px hairline entry rows. At 900px the margin unsticks and
becomes a horizontal tally strip; at 620px the bands become one column.

FORM: Margin ledger with state bands. Candidate 7 on the ordered list, dealt as
the lead by the surface roll (seed 3de8f2d0, dealt 7, 6, 3) and built
unattended after no decision page was served; the two other dealt structures
were declined and raised the lead instead. Candidate 6, the diary spread,
contributed the weekday on every finished entry; candidate 3, the week spine,
contributed ordering Finished by the day it happened, so the week's rhythm is
still readable inside the band. Signature moment: changing weeks fades the
whole sheet in from 8px below over 220ms with the board's exponential ease-out,
keyed to the visible Monday. That is the page's only motion; reduced motion
disables it, and rows never animate because nothing on them is actionable.

Deliberate divergence from DESIGN.md's task rows: finished entries are not
struck through. A whole band of struck text is unreadable and the band heading
already says Finished, so the completion date carries it instead.
