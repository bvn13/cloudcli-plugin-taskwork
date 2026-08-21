# Changelog

All notable changes to this plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the versioning
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

`package.json` and `manifest.json` always carry the same version; `npm run build`
refuses to run otherwise.

## [Unreleased]

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
