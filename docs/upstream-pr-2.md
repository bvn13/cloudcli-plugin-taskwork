# PR-2 — `feat(plugins): give plugins an authenticated way to reach the host API`

Target: `siteboon/claudecodeui`, base tag `v1.37.2`.
Branch: `github:bvn13/claudecodeui@feat/plugin-host-api`.
Patch: [`patches/0002-feat-plugin-host-api.patch`](../patches/0002-feat-plugin-host-api.patch).
Opened after the discussion in issue *"Plugins have no sanctioned way to read host data"*.

## Problem

The plugin documentation contradicts itself.

*Security Model → Frontend Isolation*:

> Your frontend module receives only the `api` object. It cannot access: …
> Authentication tokens or session cookies … localStorage or sessionStorage of
> the host app.

*Plugin System Overview → Communication* — the official WebSocket example:

```js
const token = localStorage.getItem('auth-token');
```

The second one is what actually happens. `PluginTabContent.tsx` imports the
plugin module from a Blob URL, so it runs in the host's realm with full access to
`window` and `localStorage`. Any plugin that needs project or session data has to
scrape the JWT out of storage — the practice the security model says is impossible.

Separately, some host actions have no HTTP equivalent at all: "start a new chat
for this project" is `handleNewSession` in `useProjectsState.ts`, pure client
state, unreachable through `/api/`.

## Proposal

Three additive members on the `api` object:

```ts
readonly hostApiVersion?: 1;
readonly surface?: 'tab' | 'sidebar';
readonly host?: {
  fetch(path: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }): Promise<Response>;
  startNewSession(projectId: string): void;
  openSession(projectId: string, sessionId: string): void;
};
```

`host.fetch` is intentionally narrow:

| Rule | Reason |
|---|---|
| **GET only** | A plugin cannot change anything in the host. Read-only removes the main security objection |
| Path must start with `/api/`, same-origin | No arbitrary URLs |
| `..`, backslashes, whitespace and encoded traversal rejected | The prefix cannot be escaped |
| `Authorization` from `init.headers` is dropped | The plugin neither sees nor forges the token |
| Implemented on top of the existing `authenticatedFetch` | No new authentication logic |

## Changes

| File | Change |
|---|---|
| `src/components/plugins/utils/pluginHostRequest.ts` *(new)* | Pure rules: path normalisation, request init, the api-object factory |
| `src/components/plugins/utils/pluginHostRequest.test.ts` *(new)* | Tests for all of the above |
| `src/components/plugins/hooks/usePluginHostApi.ts` *(new)* | Binds those rules to `authenticatedFetch` and the navigation callbacks |
| `src/components/plugins/view/PluginTabContent.tsx` | Builds the api object through the factory; adds `hostApiVersion`, `host`, `surface` |
| `src/components/main-content/view/MainContent.tsx`, `types/types.ts` | New `onStartNewSession` prop, threaded to the plugin surface |
| `src/components/app/AppContent.tsx` | Passes the existing `handleNewSession` down |

## Compatibility

Every added field is optional and every existing signature is unchanged. A
plugin that knows nothing about `api.host` behaves exactly as before — covered by
a test that asserts the api object's key set.

## Non-goals

Mutating requests, WebSocket access, and permission gating via
`manifest.permissions` (already reserved but unused). Those deserve their own
design; this PR is the smallest change that removes the need to scrape a token.

## Open questions for maintainers

1. Is `hostApiVersion` the shape you want for versioning, or would you rather
   plugins feature-detect only?
2. Should `host.fetch` be restricted to an allowlist of endpoints rather than the
   whole `/api/` prefix?
3. Would you prefer the navigation intents to be expressed as one
   `navigate(intent)` method instead of two named ones?
