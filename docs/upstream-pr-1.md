# PR-1 — `feat(sidebar): let the sidebar be resized`

Target: `siteboon/claudecodeui`, base branch `main`, base tag of the work `v1.37.2`.
Head: `bvn13:feat/resizable-sidebar`.
Patch: [`patches/0001-feat-resizable-sidebar.patch`](../patches/0001-feat-resizable-sidebar.patch).
Open after the discussion issue (`spec/upstream/issue-0-resizable-sidebar.md` in the workspace repository).

---

**Title:**

```
feat(sidebar): let the sidebar be resized
```

**Body:**

Closes #<issue>.

### What this changes

The desktop sidebar has been fixed at `288px` (`md:w-72`). This adds a drag
handle on its right edge so the width can be adjusted and remembered.

- Drag to resize, clamped to **220–640px**, default unchanged at **288px**.
- The width is persisted in `localStorage['sidebar-width']`.
- Double-click or `Home` resets to the default; `←`/`→` adjust in 16px steps.
- The mobile drawer is untouched.

### Why

On a wide monitor the fixed width wastes space; with long project names or deep
paths every entry truncates and there is no way to see more. The editor side
panel already offers exactly this affordance (`useEditorSidebar`), so this makes
the two consistent.

### How it works

| File | Change |
|---|---|
| `src/hooks/useSidebarWidth.ts` *(new)* | Reads/writes `localStorage['sidebar-width']`, clamps to `[220, 640]`, default `288`. Kept out of `useUiPreferences` because that store is boolean-only (`parseBoolean`, `VALID_KEYS`) |
| `src/hooks/useSidebarWidth.test.ts` *(new)* | Clamping, restore, and fallback for a malformed stored value |
| `src/components/app/AppContent.tsx` | Desktop wrapper gets `style={{ width: sidebarWidth }}` and the drag handle |
| `src/components/sidebar/view/subcomponents/SidebarContent.tsx` | `md:w-72` → `md:w-full`, so the sidebar fills the width the wrapper sets |
| `src/i18n/locales/*/common.json` | One new aria-label, translated in all 11 locales |

Interaction details: `pointerdown` calls `setPointerCapture` and sets
`body.style.userSelect = 'none'` so the drag survives the cursor leaving the 4px
handle and does not select text; `pointermove` schedules the update through
`requestAnimationFrame` and only the final width is written to storage on
`pointerup`/`pointercancel`. A cleanup effect restores `userSelect` if the
component unmounts mid-drag.

The handle is a `role="separator"` with `aria-orientation="vertical"`,
`aria-valuenow/min/max`, `tabIndex=0` and a visible focus ring, so it is usable
without a mouse.

A stored value that is missing, unparseable or out of range falls back to the
default — a stale `localStorage` entry cannot leave the sidebar unusable.

### Verification

- `npm run typecheck`, `npm run lint` (no new warnings), `npm run build:client` — clean.
- `npm run test:client` — passes, including the three new cases.
- Manually: dragging, persistence across reload, double-click reset, keyboard
  adjustment, and the mobile drawer left unchanged.

### Scope

No API, contract or data-model change; nothing outside the sidebar's width is
touched. Behaviour for a user who never drags the handle is identical to today.
