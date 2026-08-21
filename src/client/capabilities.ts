/** The plugin API as handed over by the host, plus the parts PR-2/PR-3 add. */

export type Surface = 'tab' | 'sidebar';

export interface PluginProject {
  /** The host's opaque project id — the contract calls the field `name`. */
  name: string;
  path: string;
}

export interface PluginSession {
  id: string;
  title: string;
}

export interface PluginContext {
  theme: 'dark' | 'light';
  project: PluginProject | null;
  session: PluginSession | null;
}

/** Introduced by PR-2. GET-only, `/api/` prefixed, token handled by the host. */
export interface PluginHostApi {
  fetch(path: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }): Promise<Response>;
  startNewSession(projectId: string): void;
  openSession(projectId: string, sessionId: string): void;
}

export interface PluginApi {
  readonly context: PluginContext;
  onContextChange(callback: (context: PluginContext) => void): () => void;
  rpc(method: string, path: string, body?: unknown): Promise<unknown>;

  /** PR-3: `'sidebar'` when mounted into the sidebar surface. Absent on a stock host. */
  readonly surface?: Surface;
  /** PR-2: contract version of `host`. Absent on a stock host. */
  readonly hostApiVersion?: 1;
  readonly host?: PluginHostApi;
}

export interface Capabilities {
  surface: Surface;
  canFetchHost: boolean;
  canNavigate: boolean;
}

/**
 * Feature detection only — never a version comparison. A host that grew the API
 * under a different name simply reads as "stock" and the plugin degrades (§6.2).
 */
export function detect(api: unknown): Capabilities {
  const a = api as { surface?: Surface; host?: Record<string, unknown> } | null;
  const host = a?.host;
  return {
    surface: a?.surface === 'sidebar' ? 'sidebar' : 'tab',
    canFetchHost: typeof host?.fetch === 'function',
    canNavigate:
      typeof host?.startNewSession === 'function' &&
      typeof host?.openSession === 'function',
  };
}
