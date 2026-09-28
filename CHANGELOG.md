# Changelog

All notable changes to this plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the versioning
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`package.json` and `manifest.json` always carry the same version; `npm run build`
refuses to run otherwise.

## [Unreleased]

### Added
- **A task row's actions live in a menu on the age badge.** Clicking the badge
  opens `Rename` and `Delete` over the tree; `Escape`, a click outside or either
  action closes it. The double-click, `F2` and `Delete` routes are unchanged.
- **The project picker filters as you type.** Its first row is a filter input
  that matches display names regardless of case; `Enter` attaches the first
  match and `↓`/`↑` move between the input and the options.

### Fixed
- **The project picker is reachable under the last task.** It now scrolls itself
  into view when it opens, and pressing a scrollbar no longer counts as a click
  outside that closes it.

### Changed
- **The task row no longer reserves width for hidden buttons.** Rename and delete
  used to be hover icons that cost 48px of every row whether or not they were
  visible — with the sidebar narrowed, that space came out of the task title.
  They moved into the age badge's menu, which reserves nothing while closed.
- **A new task's draft row no longer disappears when it loses focus.** Only
  `Enter` (saves), `Escape`, an empty title or a second `+` closes it; clicking
  anywhere else keeps the row and the text typed into it. The text now also
  survives a re-render of the tree — including the one that shows a save error —
  and the draft never pulls focus back from wherever the user moved it.
- **The host patches moved to current upstream `main`** (`3ed3be5a`, a few commits
  past CloudCLI `1.37.3`). All three are regenerated from the feature branches,
  which are kept current by merging `main` into them rather than by sitting on a
  release tag, and carry the work done since they were last exported: the section
  chips fold into a `…` dropdown (`0001`), and the host-API path check no longer
  looks at the query string (`0002`, review fix from upstream PR #1191, together
  with assigning the host api ref in an effect instead of during render).
  `0002` and `0003` apply to the `v1.37.3` tag unchanged; `0001` needs the
  Indonesian locale upstream added just after the release.

## [1.1.0] — 2026-08-21

Both fixes come from the first run on a real host.

### Fixed
- **An attachment no longer adopts a session that predates it.** The "latest
  session of the project" heuristic picked up an old conversation for any project
  that already had chats, and clicking the node reopened it instead of the new
  chat. A session now counts only if it was created after `attachedAt`.
- **The tree rendered unstyled.** The host publishes its palette as raw HSL
  triples (`--accent: 44 15% 91%`), so `var(--accent)` was not a valid colour and
  every rule using it was dropped — no hover, no rails, no accents.

### Changed
- The section now mirrors the host's own project list: same row padding and
  radius, the same hover accent, a left rail under an expanded task, two-line
  rows (project over session) and primary-coloured action buttons.
- Icons are inline SVG in the host's lucide style, built through the DOM.
- E8 (`PATCH /tasks/:taskId/attachments/:projectId`) is now called by the UI: the
  first session that qualifies is pinned, so the binding stops moving with later
  sessions. It was previously implemented and tested but unused.

## [1.0.0] — 2026-08-21

The sidebar release: with the host patches applied, `Tasks` sits in the sidebar
left of `Projects`, which is the layout this plugin was designed for.

### Added
- `sidebar` object in the manifest (`label: Tasks`, `order: 50`,
  `replacesTab: true`). Hosts without the sidebar patch ignore it and keep
  showing the `Task Work` tab, so the same build serves every configuration.
- `patches/` — three independent patches against host `v1.37.2`, generated from
  the fork's feature branches: resizable sidebar, plugin host API, plugin sidebar
  surface. Each applies on its own, in any order.
- `docs/upstream-pr-2.md`, `docs/upstream-pr-3.md` — the pull request write-ups.

### Notes
- Full mode (project drop-down, session titles, navigation) shipped in 0.1.0 and
  activates by feature detection as soon as the host exposes `api.host`; no
  separate plugin release was needed for it.

## [0.1.0] — 2026-08-21

First release: fully usable on a **stock** host, with no patch applied.

### Added
- Task tree with create, inline rename, delete and expand/collapse; tasks sorted
  newest first, each with a compact age badge matching the host's own format.
- Exclusive project locking: a project belongs to at most one task, enforced
  atomically in the plugin's backend, so two clients racing produce one winner.
- Stock-mode attachment: `Attach “<current project>”` for the project selected in
  the host, with clear hints when none is selected or it is already taken.
- Backend over the plugin RPC channel: `/health`, `/tasks` CRUD, attachments and
  `/locked-projects`; JSON store at `~/.claude-code-ui/taskwork/tasks.json` with
  atomic writes and recovery from a corrupt file.
- Keyboard navigation and ARIA tree semantics.
- Capability detection (`api.surface`, `api.host`) with graceful degradation.

### Security
- The plugin never reads the host's `localStorage` or auth token; the only
  storage key it uses is `taskwork:expanded`. Enforced by `npm run check` and a test.
