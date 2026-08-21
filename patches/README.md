# Host patches

> **Generated files — do not edit.** They are exported from the feature branches
> of the host fork (`github:bvn13/claudecodeui`) by `scripts/export-patches.sh`
> in the workspace repository. Editing a `.patch` here only makes it disagree
> with the branch it came from.

Base: upstream tag **`v1.37.2`** of `siteboon/claudecodeui`.

| Patch | Branch | Upstream PR | What it does |
|---|---|---|---|
| `0001-feat-resizable-sidebar.patch` | `feat/resizable-sidebar` | PR-1 | The sidebar can be dragged to a different width, persisted across reloads |
| `0002-feat-plugin-host-api.patch` | `feat/plugin-host-api` | PR-2 | `api.host`: authenticated GET-only access to `/api/*`, plus two navigation intents |
| `0003-feat-plugin-sidebar-surface.patch` | `feat/plugin-sidebar-surface` | PR-3 | A plugin may contribute a section to the sidebar via an optional `sidebar` manifest object |

The numeric prefix is the intended publication order, not a dependency: each
patch applies to `v1.37.2` on its own, in any order, and the host builds and
starts after each one.

## Applying

```bash
git clone https://github.com/siteboon/claudecodeui.git
cd claudecodeui
git checkout -b my-host v1.37.2

git am /path/to/patches/0002-feat-plugin-host-api.patch      # any subset, any order
npm ci && npm run build
```

`git apply` works too if you do not want the commit history:

```bash
git apply --check patches/0002-feat-plugin-host-api.patch && git apply patches/0002-feat-plugin-host-api.patch
```

## Version ↔ capability matrix

| Host state | `api.surface` | `api.host` | Task Work runs as |
|---|---|---|---|
| stock `v1.37.2` | `undefined` | `undefined` | Tab, limited mode: attach the current project only |
| + PR-2 | `'tab'` | object | Tab, full mode: project drop-down, session titles, navigation |
| + PR-2 + PR-3 | `'sidebar'` | object | Sidebar chip `Tasks`, left of `Projects`, full mode |
| + PR-3 only | `'sidebar'` | `undefined` | Sidebar chip, limited mode — supported combination |
| + PR-1 | — | — | Unchanged; the sidebar simply becomes resizable |

## Regenerating

From the workspace repository (`cloudcli-taskwork`):

```bash
./scripts/export-patches.sh          # defaults to base tag v1.37.2
```

Mandatory before every plugin release and after any rebase of the feature
branches onto a newer upstream tag. `npm run check` in this repository verifies
the patches carry no domain vocabulary of this plugin: each one has to stand on
its own as a generic host feature.
