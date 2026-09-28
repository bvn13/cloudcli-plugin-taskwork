# PR-3 — `feat(plugins): let plugins contribute a section to the sidebar`

Target: `siteboon/claudecodeui`, base branch `main` (in sync with `3cc73ede`, 2026-09-28).
Head: `bvn13:feat/plugin-sidebar-surface`.
Patch: [`patches/0003-feat-plugin-sidebar-surface.patch`](../patches/0003-feat-plugin-sidebar-surface.patch).

> **Не опубликован.** Порядок: сначала issue #2
> (`spec/upstream/issue-2-plugin-sidebar-surface.md` в воркспейсе), затем этот PR
> со ссылкой `Closes #<номер issue>`. Ветка на GitHub — `f9188b2d`, слита с `main`
> после того, как туда вошёл PR-1 (#1189) со складыванием чипов в «…».

---

## Problem

The main content area already has a generic mechanism for plugins:
`WorkspaceTabs` renders `builtInTabs + pluginTabs` and
`PluginTabContent` mounts the module. The sidebar has nothing comparable, so a
plugin whose content belongs next to the project list — anything that organises
or filters projects and sessions — has nowhere to live.

## Proposal

An optional `sidebar` object in `manifest.json`:

```json
{
  "slot": "tab",
  "sidebar": { "label": "Notes", "icon": "icon.svg", "order": 50, "replacesTab": true }
}
```

| Field | Type | Default | Meaning |
|---|---|---|---|
| `label` | string, 1–24 chars | `displayName` | Chip caption in the sidebar header |
| `icon` | string | manifest `icon` | Plugin SVG asset, rendered through the existing sanitising `PluginIcon` |
| `order` | finite number | `500` | Position in the chip row: `projects=100`, `conversations=200`, `running=300`, `archived=400` |
| `replacesTab` | boolean | `false` | Hide the plugin's main-area tab, since it now lives in the sidebar |

`slot` deliberately stays `"tab"`. Adding a new value to `ALLOWED_SLOTS` would
make the manifest fail validation on every older host
(`plugin-registry.service.ts`), so the plugin could not be installed at all. An
additional, ignored object degrades cleanly instead.

## Changes

**Server**

| File | Change |
|---|---|
| `server/modules/plugins/plugin-registry.service.ts` → `validateManifest` | Validates the optional `sidebar` object |
| `server/modules/plugins/plugin-registry.service.ts` → `normalizeSidebar` *(new)*, `scanPlugins` | Emits a fixed, defaulted shape; arbitrary manifest fields still never reach the client |
| `server/modules/plugins/tests/plugin-registry.sidebar.test.ts` *(new)* | Validation and normalisation tests |

**Client**

| File | Change |
|---|---|
| `src/shared/types.ts` | `SidebarTab = { kind: 'builtin'; mode } \| { kind: 'plugin'; name }`; `SidebarSearchMode` untouched |
| `src/modules/sidebar/utils/sidebarTabs.ts` *(new)* + tests | Chip ordering, persistence parsing, which sections show the search box — all pure |
| `src/modules/sidebar/hooks/useSidebarController.ts` | `sidebarTab` state, persisted in `localStorage['sidebar-tab']`, falling back to Projects when a plugin disappears |
| `src/modules/sidebar/SidebarModeTabs.tsx` | Takes the sidebar tab and the plugin chips: built-in and plugin chips form one ordered row, and the ones that do not fit fold into the existing `…` menu alike |
| `src/modules/sidebar/SidebarHeader.tsx` | Passes the plugin chips down; the search box is hidden while a plugin section is active |
| `src/modules/sidebar/SidebarPluginSurface.tsx` *(new)* | Mounts the module exactly like `PluginTabContent`, with `api.surface === 'sidebar'` |
| `src/modules/sidebar/SidebarContent.tsx`, `Sidebar.tsx` | Render the plugin surface in place of the project list |
| `src/shared/ui/ActionMenu.tsx` | `ActionMenuItem.icon` accepts any component taking a `className` — a plugin icon in the `…` menu is not a lucide one |
| `src/modules/plugins/utils/pluginSurfaces.ts` *(new)* + tests | `replacesTab` filtering and the surface badge text |
| `src/modules/project-workspace/WorkspaceTabs.tsx` | Filters out plugins with `replacesTab: true` |
| `src/modules/plugins/PluginSettingsTab.tsx` | Badge now reads `Tab`, `Sidebar` or `Tab + Sidebar` |

No new i18n keys: plugin labels come from the manifest.

## Compatibility

With no enabled plugin declaring `sidebar`, the chip row and the sidebar behave
exactly as today — no plugin chips, the same four built-in tabs folding the same
way (`sidebarTabs.test.ts`: *a host with no sidebar plugins produces no chips at
all*; `sidebarModeTabs.test.tsx` keeps main's width tests). The change
is independent of PR-2: with only this patch applied a plugin gets
`api.surface === 'sidebar'` and no `api.host`, which is a supported combination.

## Open questions for maintainers

1. Is `order` as a plain number the right knob, or would you prefer named
   anchors (`before: 'projects'`)?
2. Should a sidebar plugin be able to render its own search box, or is hiding
   the built-in one enough?
3. Should `replacesTab` be the plugin's decision, or a user preference in
   Settings → Plugins?
