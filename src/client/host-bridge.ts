import type { Capabilities, PluginApi } from './capabilities.js';

export interface HostProject {
  projectId: string;
  displayName: string;
  fullPath: string;
}

export interface HostSession {
  id: string;
  title: string;
  createdAt: string | null;
}

/** The host rejected the request: the user's session is gone, retrying is pointless (§11). */
export class HostAuthError extends Error {
  constructor() {
    super('Session expired — reload the page.');
    this.name = 'HostAuthError';
  }
}

export class HostUnsupportedError extends Error {
  constructor(operation: string) {
    super(`NOT_SUPPORTED: ${operation}`);
    this.name = 'HostUnsupportedError';
  }
}

export interface HostBridge {
  readonly capabilities: Capabilities;
  listProjects(): Promise<HostProject[]>;
  listSessions(projectId: string, limit: number): Promise<HostSession[]>;
  startNewSession(projectId: string): Promise<void>;
  openSession(projectId: string, sessionId: string): Promise<void>;
  /** Drops cached host data — called on context change and on Refresh. */
  invalidate(): void;
}

const SESSION_CACHE_TTL_MS = 30_000;

function readString(source: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

function toHostProject(raw: unknown): HostProject | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const projectId = readString(source, 'projectId');
  if (!projectId) return null;
  return {
    projectId,
    displayName: readString(source, 'displayName') ?? projectId,
    fullPath: readString(source, 'fullPath', 'path') ?? '',
  };
}

function toHostSession(raw: unknown): HostSession | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const id = readString(source, 'id');
  if (!id) return null;
  return {
    id,
    title: readString(source, 'title', 'summary', 'name') ?? 'Untitled session',
    createdAt: readString(source, 'createdAt', 'created_at', 'lastActivity'),
  };
}

/** Newest first; the host's own ordering is not part of any contract (§9.5.1). */
function sortByCreatedAtDesc(sessions: HostSession[]): HostSession[] {
  return [...sessions].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}

/** Full mode: everything goes through `api.host`, never through the host's localStorage (D-3). */
export class HostApiBridge implements HostBridge {
  private readonly sessionCache = new Map<string, { at: number; sessions: HostSession[] }>();

  constructor(
    private readonly api: PluginApi,
    readonly capabilities: Capabilities,
  ) {}

  invalidate(): void {
    this.sessionCache.clear();
  }

  async listProjects(): Promise<HostProject[]> {
    const payload = await this.get('/api/projects?skipSync=1');
    const list = Array.isArray(payload)
      ? payload
      : (payload as { projects?: unknown[] } | null)?.projects ?? [];
    return (list as unknown[]).map(toHostProject).filter((p): p is HostProject => p !== null);
  }

  async listSessions(projectId: string, limit: number): Promise<HostSession[]> {
    const cached = this.sessionCache.get(projectId);
    if (cached && Date.now() - cached.at < SESSION_CACHE_TTL_MS) return cached.sessions;

    const payload = await this.get(
      `/api/projects/${encodeURIComponent(projectId)}/sessions?limit=${limit}&offset=0`,
    );
    const list = Array.isArray(payload)
      ? payload
      : (payload as { sessions?: unknown[] } | null)?.sessions ?? [];
    const sessions = sortByCreatedAtDesc(
      (list as unknown[]).map(toHostSession).filter((s): s is HostSession => s !== null),
    );

    this.sessionCache.set(projectId, { at: Date.now(), sessions });
    return sessions;
  }

  async startNewSession(projectId: string): Promise<void> {
    if (!this.capabilities.canNavigate) throw new HostUnsupportedError('startNewSession');
    this.api.host?.startNewSession(projectId);
  }

  async openSession(projectId: string, sessionId: string): Promise<void> {
    if (!this.capabilities.canNavigate) throw new HostUnsupportedError('openSession');
    this.api.host?.openSession(projectId, sessionId);
  }

  private async get(path: string): Promise<unknown> {
    const host = this.api.host;
    if (!host) throw new HostUnsupportedError(path);

    const response = await host.fetch(path);
    if (response.status === 401 || response.status === 403) throw new HostAuthError();
    if (!response.ok) throw new Error(`Host request failed (HTTP ${response.status})`);
    return response.json() as Promise<unknown>;
  }
}

/**
 * Stock mode: `api.context` is the only source of host data there is, and this
 * implementation performs no network request at all (§6.3, T-F7).
 */
export class ContextOnlyBridge implements HostBridge {
  constructor(
    private readonly api: PluginApi,
    readonly capabilities: Capabilities,
  ) {}

  invalidate(): void {
    // Nothing is cached: the context is read straight off the api object.
  }

  async listProjects(): Promise<HostProject[]> {
    const project = this.api.context.project;
    if (!project) return [];
    return [{
      projectId: project.name,
      displayName: basename(project.path) || project.name,
      fullPath: project.path,
    }];
  }

  async listSessions(): Promise<HostSession[]> {
    return [];
  }

  async startNewSession(): Promise<void> {
    throw new HostUnsupportedError('startNewSession');
  }

  async openSession(): Promise<void> {
    throw new HostUnsupportedError('openSession');
  }
}

/** Last path segment of a full project path — the host's display name is out of reach in stock mode. */
export function basename(fullPath: string): string {
  const parts = fullPath.split(/[\\/]/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? '';
}

export function createBridge(api: PluginApi, capabilities: Capabilities): HostBridge {
  return capabilities.canFetchHost
    ? new HostApiBridge(api, capabilities)
    : new ContextOnlyBridge(api, capabilities);
}
