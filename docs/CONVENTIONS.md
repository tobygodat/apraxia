# Conventions

Repository-wide habits. Architecture and placement rules are in
[architecture](ARCHITECTURE.md); working style is in
[AGENTS.md](../AGENTS.md).

## Folder layout

- `frontend/src/features/<area>/` is the unit of organization: components, their
  CSS, the service that talks to Supabase or `/api`, and pure helpers all live
  together. Current areas are `todos`, `collections`, `calendar`, `classes`.
- `frontend/src/components/` is only for UI used by more than one feature.
- `frontend/src/apps/` holds entry points and the shell runtime;
  `frontend/src/auth/`, `config/`, `lib/`, `types/`, `qa/` hold their namesakes.
- `api/` files are thin Vercel entry points; the logic lives in `server/`.
- `shared/` is for contracts both sides import. It must stay free of React,
  Supabase, and Node built-ins.
- `frontend/src/pages/`, `components/{Layout,Login,ResourcePage}.tsx`,
  `api/client.ts`, and `src/orbitos/` are preserved legacy. Do not extend them.

## Naming

| Thing | Style | Example |
| --- | --- | --- |
| Component file | `PascalCase.tsx`, one main export | `TodayPanel.tsx` |
| Module of helpers or a service | `camelCase.ts` | `todoController.ts`, `collectionService.ts` |
| Service factory | `create<Name>Service` returning an interface | `createNoteService` |
| Test | sibling file, `<subject>.test.ts(x)` | `eventLayout.test.ts` |
| CSS file | `camelCase.css` next to its component, or `<area>.css` for a shared sheet | `TodayList.css`, `calendar.css` |
| Migration | `<UTC timestamp>_<snake_case>.sql` | `20260913000300_classes_and_notes.sql` |
| pgTAP test | `<ordinal>_<snake_case>.test.sql` | `030_soft_delete_restore.test.sql` |
| SQL function argument | `p_` prefix; local variable `v_` prefix | `p_local_date`, `v_uid` |

Database identifiers are `snake_case`; browser contracts in
`frontend/src/types/domain.ts` are `camelCase`. The service layer is where the
two meet, so mapping code belongs there and nowhere else.

The product says "Tasks" in the interface and `todos` in routes, code, and
tables. Do not rename either half in passing.

## CSS

- Plain CSS, one stylesheet per feature or component, imported by the component
  that needs it. No CSS modules, no preprocessor, no utility framework.
- Global tokens and the legacy shell live in `frontend/src/index.css`. Local
  design tokens are scoped custom properties declared on the component's root
  class (for example `--cloud-shell-bg` in
  `frontend/src/components/app-shell/CloudAppShell.css`).
- Class names are BEM-style and prefixed by their area:
  `block`, `block__element`, `block--modifier`, as in `calendar-event`,
  `calendar-event__location`, `calendar-event--all-day`. Keep the prefix unique
  per feature so stylesheets never collide.
- Keep selectors flat. Do not add element or descendant selectors that reach
  into another feature's markup.
- When two sheets style the same element, the winning rule must win on
  specificity, not on import order. Stylesheet order follows the module graph
  and changes whenever an import moves (a header margin once depended on
  `HomeHeader` being imported before the shell).
- Visual decisions, palette, and typography are documented in
  [DESIGN.md](../DESIGN.md). Reuse the existing tokens rather than adding
  new literals.

## Error copy

Errors thrown at a service boundary are user-facing text, so write them as such:

- One or two short sentences, sentence case, ending in a period.
- Say what failed and what the person can do: "Couldn't load your page
  appearance. Try again."
- Reassure when a draft survives: "Couldn't confirm the save. Your draft is
  still here; try again."
- For input problems, state the rule: "Use a page name of 100 characters or
  fewer."
- Never include provider responses, status codes, SQL, stack detail, tokens, or
  email addresses. Sanitize at the boundary, and log nothing sensitive.
- Use a typographic apostrophe in contractions, matching existing copy.

Errors that are not meant for a person (invariant violations in parsing code)
stay short and technical, for example `Invalid workspace response.`

## Test placement

| Kind | Location | Environment |
| --- | --- | --- |
| Pure helper or model | next to the module, `*.test.ts` | default `node` |
| Component | next to the component, `*.test.tsx` | add `// @vitest-environment happy-dom` on line 1 |
| Server, transport, SQL-on-PGlite, config contract | `tests/contract/` | `node` |
| Needs local Supabase over HTTP | `tests/local/` or `frontend/tests/local/` | `vitest.local.config.ts`, not run in CI |
| Database policy, role, and function behavior | `supabase/tests/*.test.sql` | pgTAP |

Add focused tests for meaningful behavior changes. Prefer a pure helper with a
small unit test over a large component test. Put RLS and role assertions in
pgTAP, where they run against real Postgres.

## Tooling

`.editorconfig`, Prettier (`.prettierrc`), ESLint (`eslint.config.js`), and
`knip` (`knip.json`) are in place. `npm run lint` runs ESLint then
`prettier --check`, and it is part of `npm run verify`;
`npm run format -- <file> [<file> ...]` formats explicit paths, and `npm run knip`
reports unused files, exports, and dependencies.

- Prettier owns layout: 100 columns, two-space indent, double quotes,
  semicolons, trailing commas. Do not hand-format; use
  `npm run format -- <changed-file>`. Avoid repository-wide formatting for a
  scoped change.
  Markdown and `supabase/**/*.sql` are excluded, so keep prose hand-wrapped.
- ESLint uses `typescript-eslint`'s recommended (not type-checked) preset plus
  `eslint-plugin-react-hooks`. The React Compiler rules that the 2026-09-14
  audit's H3/H4/M3 refactors would satisfy are off with a note in the config;
  everything else is on. Fix violations rather than widening a rule, and give
  any `eslint-disable` a one-line reason.
- `knip.json` covers `frontend/src`, `api/`, `server/`, `shared/`, `scripts/`,
  and the test trees. The preserved legacy `frontend/src/api/**` and the
  generated `frontend/src/types/database.ts` are in its ignore list; the legacy
  `frontend/src/pages/**` stays reachable through `App.tsx` and needs none.
  Prefer dropping an unnecessary `export` over deleting a used symbol.
- `noUnusedLocals` and `noUnusedParameters` are on in both `tsconfig` files.
