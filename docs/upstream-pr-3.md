# PR-3 — `feat(plugins): let plugins contribute a section to the sidebar`

Target: `siteboon/claudecodeui`, base tag `v1.37.2`.
Branch: `github:bvn13/claudecodeui@feat/plugin-sidebar-surface`.
Patch: [`patches/0003-feat-plugin-sidebar-surface.patch`](../patches/0003-feat-plugin-sidebar-surface.patch).

## Problem

The main content area already has a generic mechanism for plugins:
`MainContentTabSwitcher` renders `builtInTabs + pluginTabs` and
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
| `plugin-registry.service.ts` → `validateManifest` | Validates the optional `sidebar` object |
| `plugin-registry.service.ts` → `normalizeSidebar` *(new)*, `scanPlugins` | Emits a fixed, defaulted shape; arbitrary manifest fields still never reach the client |
| `tests/plugin-registry.sidebar.test.ts` *(new)* | Validation and normalisation tests |

**Client**

| File | Change |
|---|---|
| `sidebar/types/types.ts` | `SidebarTab = { kind: 'builtin'; mode } \| { kind: 'plugin'; name }`; `SidebarSearchMode` untouched |
| `sidebar/utils/sidebarTabs.ts` *(new)* + tests | Ordering, persistence parsing, `replacesTab` filtering — all pure |
| `sidebar/hooks/useSidebarController.ts` | `sidebarTab` state, persisted in `localStorage['sidebar-tab']`, with a fallback when a plugin disappears |
| `sidebar/view/subcomponents/SidebarHeader.tsx` | One ordered chip row for built-in and plugin sections; the search box is hidden while a plugin section is active |
| `sidebar/view/subcomponents/SidebarPluginSurface.tsx` *(new)* | Mounts the module exactly like `PluginTabContent`, with `api.surface === 'sidebar'` |
| `sidebar/view/subcomponents/SidebarContent.tsx` | Renders the plugin surface in place of the project list |
| `main-content/view/subcomponents/MainContentTabSwitcher.tsx` | Filters out plugins with `replacesTab: true` |
| `plugins/view/PluginSettingsTab.tsx` | Badge now reads `Tab`, `Sidebar` or `Tab + Sidebar` |

No new i18n keys: plugin labels come from the manifest.

## Compatibility

With no enabled plugin declaring `sidebar`, the chip row and the sidebar are
byte-for-byte the behaviour of today — covered by a regression test. The change
is independent of PR-2: with only this patch applied a plugin gets
`api.surface === 'sidebar'` and no `api.host`, which is a supported combination.

## Open questions for maintainers

1. Is `order` as a plain number the right knob, or would you prefer named
   anchors (`before: 'projects'`)?
2. Should a sidebar plugin be able to render its own search box, or is hiding
   the built-in one enough?
3. Should `replacesTab` be the plugin's decision, or a user preference in
   Settings → Plugins?
