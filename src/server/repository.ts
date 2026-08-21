import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Attachment, StoreFile, Task } from '../shared/types.js';

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** ULID-shaped id: 10 time characters keep ids roughly sortable, 6 random ones make them unique. */
function generateTaskId(now: number): string {
  let time = '';
  let rest = now;
  for (let i = 0; i < 10; i += 1) {
    time = CROCKFORD[rest % 32] + time;
    rest = Math.floor(rest / 32);
  }

  const bytes = crypto.randomBytes(6);
  let random = '';
  for (const byte of bytes) random += CROCKFORD[byte % 32];

  return `tsk_${time}${random}`;
}

/** The store lives outside the plugin directory: that directory is wiped on Update. */
export function defaultStoreDir(): string {
  const home = process.env.HOME || os.homedir();
  return path.join(home, '.claude-code-ui', 'taskwork');
}

function emptyStore(): StoreFile {
  return { schemaVersion: 1, tasks: [] };
}

function isTask(value: unknown): value is Task {
  const task = value as Partial<Task> | null;
  return (
    typeof task === 'object' && task !== null &&
    typeof task.id === 'string' &&
    typeof task.title === 'string' &&
    typeof task.createdAt === 'string' &&
    typeof task.updatedAt === 'string' &&
    Array.isArray(task.attachments) &&
    task.attachments.every((a: unknown) => {
      const attachment = a as Partial<Attachment> | null;
      return (
        typeof attachment === 'object' && attachment !== null &&
        typeof attachment.projectId === 'string' &&
        typeof attachment.projectName === 'string' &&
        typeof attachment.attachedAt === 'string' &&
        (attachment.sessionId === null || typeof attachment.sessionId === 'string')
      );
    })
  );
}

function parseStore(raw: string): StoreFile {
  const parsed: unknown = JSON.parse(raw);
  const store = parsed as Partial<StoreFile> | null;
  if (typeof store !== 'object' || store === null || !Array.isArray(store.tasks)) {
    throw new Error('store is not a task file');
  }
  if (!store.tasks.every(isTask)) {
    throw new Error('store contains malformed tasks');
  }
  return { schemaVersion: 1, tasks: store.tasks };
}

export class Repository {
  private store: StoreFile;
  /** Serialises every read-modify-write so concurrent RPCs cannot interleave (§7.4). */
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly dir: string,
    private readonly file: string,
    store: StoreFile,
  ) {
    this.store = store;
  }

  /** Loads the store (or recovers from a corrupt one) before the server starts listening. */
  static open(dir: string = defaultStoreDir()): Repository {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, 'tasks.json');

    let store = emptyStore();
    if (fs.existsSync(file)) {
      try {
        store = parseStore(fs.readFileSync(file, 'utf8'));
      } catch (error) {
        // INV-7: never start on top of unreadable data — keep it aside and start empty.
        const backup = path.join(dir, `tasks.corrupt-${Date.now()}.json`);
        try {
          fs.renameSync(file, backup);
          process.stderr.write(`[taskwork] tasks.json is corrupt (${String(error)}); backed up to ${path.basename(backup)}\n`);
        } catch (renameError) {
          process.stderr.write(`[taskwork] tasks.json is corrupt and could not be backed up: ${String(renameError)}\n`);
        }
        store = emptyStore();
      }
    }

    return new Repository(dir, file, store);
  }

  get storePath(): string {
    return this.file;
  }

  /** INV-5: newest first. */
  listTasks(): Task[] {
    return structuredClone(this.store.tasks).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** INV-3, exposed for the UI so taken projects can be filtered out up front (E9). */
  lockedProjectIds(): string[] {
    return this.store.tasks.flatMap((task) => task.attachments.map((a) => a.projectId));
  }

  createTask(title: string): Promise<Task> {
    return this.mutate((store) => {
      const now = new Date();
      const iso = now.toISOString();

      let id = generateTaskId(now.getTime());
      while (store.tasks.some((task) => task.id === id)) id = generateTaskId(now.getTime()); // INV-1

      const task: Task = { id, title, createdAt: iso, updatedAt: iso, attachments: [] };
      store.tasks.push(task);
      return task;
    });
  }

  renameTask(taskId: string, title: string): Promise<Task> {
    return this.mutate((store) => {
      const task = this.find(store, taskId);
      task.title = title;
      task.updatedAt = new Date().toISOString();
      return task;
    });
  }

  deleteTask(taskId: string): Promise<void> {
    return this.mutate((store) => {
      const index = store.tasks.findIndex((task) => task.id === taskId);
      if (index === -1) throw new NotFoundError(`Task ${taskId} does not exist.`);
      // Removing the task releases every project it held (INV-3).
      store.tasks.splice(index, 1);
    });
  }

  attachProject(taskId: string, projectId: string, projectName: string): Promise<Task> {
    return this.mutate((store) => {
      const task = this.find(store, taskId);

      // INV-3 is global: a project belongs to at most one task in the whole store.
      const holder = store.tasks.find((candidate) =>
        candidate.attachments.some((a) => a.projectId === projectId));
      if (holder) throw new ConflictError('Project is attached to another task.');

      const attachment: Attachment = {
        projectId,
        projectName,
        attachedAt: new Date().toISOString(),
        sessionId: null,
      };
      task.attachments.push(attachment);
      task.updatedAt = attachment.attachedAt;
      return task;
    });
  }

  detachProject(taskId: string, projectId: string): Promise<Task> {
    return this.mutate((store) => {
      const task = this.find(store, taskId);
      const index = task.attachments.findIndex((a) => a.projectId === projectId);
      if (index === -1) throw new NotFoundError(`Project ${projectId} is not attached to ${taskId}.`);

      task.attachments.splice(index, 1);
      task.updatedAt = new Date().toISOString();
      return task;
    });
  }

  setAttachmentSession(taskId: string, projectId: string, sessionId: string): Promise<Task> {
    return this.mutate((store) => {
      const task = this.find(store, taskId);
      const attachment = task.attachments.find((a) => a.projectId === projectId);
      if (!attachment) throw new NotFoundError(`Project ${projectId} is not attached to ${taskId}.`);

      attachment.sessionId = sessionId;
      task.updatedAt = new Date().toISOString();
      return task;
    });
  }

  private find(store: StoreFile, taskId: string): Task {
    const task = store.tasks.find((candidate) => candidate.id === taskId);
    if (!task) throw new NotFoundError(`Task ${taskId} does not exist.`);
    return task;
  }

  /**
   * Runs `change` against a private copy of the store; on success the copy is
   * persisted and becomes the new in-memory state, on failure nothing changes.
   * Queued end to end, so a read-modify-write can never interleave with another.
   */
  private mutate<T>(change: (store: StoreFile) => T): Promise<T> {
    const run = async (): Promise<T> => {
      const draft = structuredClone(this.store);
      const result = change(draft);
      await this.persist(draft);
      this.store = draft;
      return structuredClone(result);
    };

    const next = this.queue.then(run, run);
    // Keep the chain alive even when a mutation rejects.
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** INV-6: write to a temp file, fsync, rename — a reader never sees a half-written store. */
  private async persist(store: StoreFile): Promise<void> {
    const temp = path.join(this.dir, `.tasks-${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`);
    const handle = await fs.promises.open(temp, 'w', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(store, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await fs.promises.rename(temp, this.file);
    } catch (error) {
      await fs.promises.rm(temp, { force: true });
      throw error;
    }
  }
}
