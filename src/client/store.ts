import type { LockedProjectsResponse, Task, TaskResponse, TasksResponse } from '../shared/types.js';
import type { PluginApi } from './capabilities.js';

export type LoadStatus = 'loading' | 'ready' | 'error';

export interface TaskState {
  status: LoadStatus;
  tasks: Task[];
  lockedProjectIds: string[];
  /** Banner text for a failure that affects the whole surface, or `null`. */
  banner: string | null;
}

export type MutationResult =
  | { ok: true; task: Task }
  | { ok: false; conflict: boolean; message: string };

const EXPANDED_KEY = 'taskwork:expanded';

/**
 * The host's `rpc()` throws `RPC error <status>` and swallows the response body,
 * so the status code is all a plugin gets to distinguish a conflict from a
 * genuine failure (PluginTabContent.tsx).
 */
export function rpcStatus(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = /RPC error (\d{3})/.exec(message);
  return match ? Number(match[1]) : null;
}

function bannerFor(error: unknown): string {
  const status = rpcStatus(error);
  if (status === 503) return 'Task Work server is not running.';
  if (status === 400) return 'The server rejected the request.';
  return 'Task Work server is not reachable.';
}

/** Reads the persisted expansion set; a broken value must never break the tree. */
function readExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

export class TaskStore {
  private state: TaskState = { status: 'loading', tasks: [], lockedProjectIds: [], banner: null };
  private readonly listeners = new Set<(state: TaskState) => void>();
  private expanded = readExpanded();
  private disposed = false;

  constructor(private readonly api: PluginApi) {}

  getState(): TaskState {
    return this.state;
  }

  subscribe(listener: (state: TaskState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  isExpanded(taskId: string): boolean {
    return this.expanded.has(taskId);
  }

  toggleExpanded(taskId: string, expanded?: boolean): void {
    const next = expanded ?? !this.expanded.has(taskId);
    if (next) this.expanded.add(taskId); else this.expanded.delete(taskId);
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...this.expanded]));
    } catch {
      // Storage disabled or full — expansion simply stops being sticky.
    }
    this.emit();
  }

  isProjectLocked(projectId: string): boolean {
    return this.state.lockedProjectIds.includes(projectId);
  }

  async loadTasks(): Promise<void> {
    this.patch({ status: this.state.tasks.length > 0 ? this.state.status : 'loading' });
    try {
      const [tasks, locked] = await Promise.all([
        this.api.rpc('GET', '/tasks') as Promise<TasksResponse>,
        this.api.rpc('GET', '/locked-projects') as Promise<LockedProjectsResponse>,
      ]);
      this.patch({
        status: 'ready',
        tasks: tasks.tasks ?? [],
        lockedProjectIds: locked.lockedProjectIds ?? [],
        banner: null,
      });
    } catch (error) {
      this.patch({ status: 'error', banner: bannerFor(error) });
    }
  }

  async refreshLocks(): Promise<void> {
    try {
      const locked = await this.api.rpc('GET', '/locked-projects') as LockedProjectsResponse;
      this.patch({ lockedProjectIds: locked.lockedProjectIds ?? [] });
    } catch {
      // Non-fatal: the backend stays the source of truth and will reject a stale attach.
    }
  }

  createTask(title: string): Promise<MutationResult> {
    return this.mutate('POST', '/tasks', { title });
  }

  renameTask(taskId: string, title: string): Promise<MutationResult> {
    return this.mutate('PATCH', `/tasks/${encodeURIComponent(taskId)}`, { title });
  }

  async deleteTask(taskId: string): Promise<boolean> {
    try {
      await this.api.rpc('DELETE', `/tasks/${encodeURIComponent(taskId)}`);
      await this.loadTasks();
      return true;
    } catch (error) {
      this.patch({ banner: bannerFor(error) });
      return false;
    }
  }

  attachProject(taskId: string, projectId: string, projectName: string): Promise<MutationResult> {
    return this.mutate('POST', `/tasks/${encodeURIComponent(taskId)}/attachments`, { projectId, projectName });
  }

  detachProject(taskId: string, projectId: string): Promise<MutationResult> {
    return this.mutate(
      'DELETE',
      `/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(projectId)}`,
    );
  }

  /** Every mutation re-reads the tree: two surfaces and two browser tabs stay in step (§11). */
  private async mutate(method: string, path: string, body?: unknown): Promise<MutationResult> {
    try {
      const response = await this.api.rpc(method, path, body) as TaskResponse;
      await this.loadTasks();
      return { ok: true, task: response.task };
    } catch (error) {
      const status = rpcStatus(error);
      if (status === 409) {
        // The winner of the race owns the project; re-read who holds what.
        await this.refreshLocks();
        return { ok: false, conflict: true, message: 'This project is already used by another task.' };
      }
      if (status === 400) {
        return { ok: false, conflict: false, message: 'The server rejected this value.' };
      }
      this.patch({ banner: bannerFor(error) });
      return { ok: false, conflict: false, message: bannerFor(error) };
    }
  }

  setBanner(banner: string | null): void {
    this.patch({ banner });
  }

  private patch(partial: Partial<TaskState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  private emit(): void {
    if (this.disposed) return;
    for (const listener of this.listeners) {
      try {
        listener(this.state);
      } catch {
        // A broken view must not take the others down with it.
      }
    }
  }
}
