# 0009 — UI foundation: Inter, Lucide icons, raised-panel shell

Status: accepted (2026-10-09)

## Context
The first screens used the system font, no icons and one flat stylesheet. Next to the
reference dashboard (white panel on a soft canvas, grouped sidebar with icons, top bar with
breadcrumbs, number tiles, tables) the app looked unfinished. A clinical tool also needs to
look trustworthy, so the visual quality matters.

## Decision
- **Font:** Inter (variable), self-hosted via `@fontsource-variable/inter`. It is bundled
  with the app, so the browser never calls Google Fonts (a third-party request that would
  send IP addresses outside our control).
- **Icons:** `lucide-react` (ISC licence, tree-shaken, no network, no crypto).
- **Shell:** sidebar on the canvas (start-session button, nav in two groups, upload state,
  user card with language switch and sign-out); main content in a raised rounded panel with a
  sticky top bar (breadcrumbs, notifications). Below 960 px the sidebar becomes a drawer.
- **Styles:** `src/design/tokens.css` (palette plus type, space, radius and shadow tokens),
  `src/design/base.css` (shared components), `src/design/shell.css`; feature styles stay in
  `src/index.css`.
- **Number tiles** (`.stat`) count work only (sessions, notes to review, uploads), never
  scores or percentages about clients (CLAUDE.md rule 11).

## Consequences
- Two small runtime dependencies; both are client-side only and add no external service.
- Nav order is unchanged; the groups are "Workspace" (Today … Reports) and "Account"
  (Keys, Settings).
- Next: rebuild the screens (Today tiles and schedule, client table, sessions calendar,
  record screen) on these components.
