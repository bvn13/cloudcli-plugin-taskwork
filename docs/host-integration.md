# Host integration

What this plugin expects from the host, what it does without, and how the two
proposed host APIs are detected.

## Compatibility matrix

| Plugin version | Host | `hostApiVersion` | Patches applied | Capabilities |
|---|---|---|---|---|
| 0.1.x | ≥ 1.37.0 | absent | none | Task tree, exclusive locking, attach the current project |
| 0.2.x | ≥ 1.37.2 | `1` | PR-2 | + project drop-down, session titles, navigation |
| 1.0.x | ≥ 1.37.2 | `1` | PR-2, PR-3 | + sidebar surface (`Tasks` chip, left of `Projects`) |

PR-1 (resizable sidebar) is independent of the plugin: it changes no contract and
adds no capability, it only makes the sidebar usable at a larger width.

## What the stock host provides

```ts
interface PluginApi {
  readonly context: {
    theme: 'dark' | 'light';
    project: { name: string; path: string } | null;   // `name` IS the projectId
    session: { id: string; title: string } | null;
  };
  onContextChange(cb: (context: PluginContext) => void): () => void;
  rpc(method: string, path: string, body?: unknown): Promise<unknown>;
}
```

Two details of the host's implementation that shape this plugin:

- `rpc()` rejects with `Error("RPC error <status>")` and drops the response body,
  so the status code is the only signal available. A `409` is read as "this
  project is already attached"; everything else surfaces as a banner.
- The client module is imported from a **Blob URL**, so it must be a single file
  with no import statements — hence the bundling step in `scripts/build.mjs`.

## What PR-2 adds — `api.host`

```ts
readonly hostApiVersion?: 1;
readonly host?: {
  fetch(path: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }): Promise<Response>;
  startNewSession(projectId: string): void;
  openSession(projectId: string, sessionId: string): void;
};
```

`fetch` is GET-only, restricted to the `/api/` prefix, same-origin, and the host
attaches the authentication itself — a plugin can neither see nor forge the token.

The plugin uses exactly two endpoints:
`GET /api/projects?skipSync=1` and `GET /api/projects/:projectId/sessions?limit=1&offset=0`.

Because the host emits no "session created" event, a fresh attachment stays
`pending` until a session that was created **after** `attachedAt` shows up in the
project's session list. Comparing against the attachment timestamp is what keeps
a project with existing chats from silently adopting an old conversation — and
from reopening it when the node is clicked. The first session that qualifies is
pinned through E8, so the binding no longer moves as newer sessions appear.

The remaining gap is inherent to the heuristic: the host creates the chat
immediately, but a session row only exists after the first message, so until
then the node reads `New chat`.

## What PR-3 adds — the sidebar surface

An optional `sidebar` object in `manifest.json`:

```json
"sidebar": { "label": "Tasks", "icon": "ListTodo", "order": 50, "replacesTab": true }
```

`slot` stays `"tab"`: a new `slot` value would fail validation on every older
host and the plugin would not install at all. `order: 50` places the chip left of
the built-in `Projects` (100) — by data, not by host code. `api.surface` becomes
`'sidebar'` and the plugin switches to compact density.

## Detection rules

```ts
canFetchHost = typeof api.host?.fetch === 'function'
canNavigate  = typeof api.host?.startNewSession === 'function'
            && typeof api.host?.openSession === 'function'
surface      = api.surface === 'sidebar' ? 'sidebar' : 'tab'
```

Feature detection only. If upstream ships the same idea under a different shape,
the plugin reads it as a stock host and keeps working; adapting means editing
`src/client/host-bridge.ts` and `src/client/capabilities.ts` and nothing else.

## Plugin RPC contract

| # | Method | Path | Body | 200 response |
|---|---|---|---|---|
| E1 | `GET` | `/health` | — | `{ status, version }` |
| E2 | `GET` | `/tasks` | — | `{ tasks }`, newest first |
| E3 | `POST` | `/tasks` | `{ title }` | `{ task }` |
| E4 | `PATCH` | `/tasks/:taskId` | `{ title }` | `{ task }` |
| E5 | `DELETE` | `/tasks/:taskId` | — | `{ deleted: true }` |
| E6 | `POST` | `/tasks/:taskId/attachments` | `{ projectId, projectName }` | `{ task }` |
| E7 | `DELETE` | `/tasks/:taskId/attachments/:projectId` | — | `{ task }` |
| E8 | `PATCH` | `/tasks/:taskId/attachments/:projectId` | `{ sessionId }` | `{ task }` |
| E9 | `GET` | `/locked-projects` | — | `{ lockedProjectIds }` |

Errors are `{ error: { code, message } }` with `400 VALIDATION_ERROR`,
`404 NOT_FOUND`, `409 PROJECT_ALREADY_ATTACHED`, `500 INTERNAL_ERROR`.

E8 is called once per attachment, the first time a session created after
`attachedAt` is observed. That is the only moment the plugin can be sure which
session belongs to the attachment without a session-created event from the host.
