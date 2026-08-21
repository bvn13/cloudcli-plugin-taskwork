# Task Work — a CloudCLI UI plugin

Organises LLM sessions into a **task tree**: every task holds the projects you
attached to it, and a project can belong to **one task at a time**.

Works on a stock CloudCLI UI host, and gains features when the host carries any
of the three upstream patches shipped in [`patches/`](patches/).

## Install

Settings → Plugins → *Install from URL*:

```
https://gitea.bvn13.me/ai-first/cloudcli-plugin-taskwork.git
```

The host clones the repository, runs `npm install --ignore-scripts` and
`npm run build`, and the **Task Work** tab appears. Requires CloudCLI UI ≥ 1.37.0
and Node.js ≥ 20. No native modules, no frontend runtime dependencies.

Your tasks live in `~/.claude-code-ui/taskwork/tasks.json` — deliberately outside
the plugin directory, which is wiped whenever the plugin is updated.

## The three configurations

| Capability | Stock host | + PR-2 (`host` API) | + PR-2 and PR-3 (target) |
|---|---|---|---|
| Where it appears | `Task Work` tab | `Task Work` tab | `Tasks` chip in the sidebar, left of `Projects` |
| Task tree, CRUD, age badge | ✅ | ✅ | ✅ |
| Exclusive project locking | ✅ | ✅ | ✅ |
| Drop-down of **all** projects | ❌ → `Attach “<current project>”` | ✅ | ✅ |
| Latest session title on a child node | ❌ → `(open in Chat)` | ✅ | ✅ |
| New session on attach | ❌ → hint | ✅ | ✅ |
| Clicking a child opens the session | ❌ | ✅ | ✅ |

The plugin detects what the host offers by feature detection alone (`api.host`,
`api.surface`) — never by version comparison — and degrades without errors and
without dead buttons. It never reads the host's `localStorage` or its auth token.

## Using it

- **`+ Add new task`** — creates a draft row; `Enter` saves, `Escape` or clicking
  away discards it. Tasks are listed newest first with a compact age badge
  (`<1m`, `42m`, `3hr`, `6d`).
- **Rename** — double-click a task, or press `F2`. Blur saves, `Escape` cancels.
- **Delete** — the `×` on hover, or `Delete`; both ask for confirmation.
- **Attach a project** — expand a task and use `+ Add project` (or
  `+ Attach “<project>”` on a stock host). Projects already attached elsewhere
  are not offered; the backend rejects the race even if two clients try at once.
- **Keyboard** — `↑`/`↓` walk the tree, `→`/`←` expand and collapse, `Enter`
  activates, `F2` renames, `Delete` removes.

Interface language is English throughout.

## The upstream patches

`patches/` holds three independent patches against host `v1.37.2`. Each one is a
generic host feature with no knowledge of this plugin, applies on its own and in
any order, and is proposed upstream separately — see
[`patches/README.md`](patches/README.md) and
[`docs/host-integration.md`](docs/host-integration.md).

## Development

```bash
npm install          # devDependency: typescript only
npm run build        # src/ -> build/ (client is bundled into one file)
npm test             # node --test: backend contract + frontend behaviour
npm run typecheck
npm run check        # version sync, patch genericity, no auth-token access
```

`build/` is committed on purpose: if a host installs the plugin without
devDependencies, the shipped build is used as-is instead of failing the install.

The client is bundled into a single `build/client/index.js` because the host
imports it from a Blob URL, where relative imports cannot resolve.

`src/client/dom.ts` is a small addition to the layout in the spec — element
helpers shared by the views, which keeps `textContent`-only rendering in one
place.

## Naming

The sidebar chip is `Tasks`, the plugin is `Task Work` — the separate
`TaskMaster` tab of the host is unrelated and unaffected.

## Licence

AGPL-3.0-or-later, following the host.
