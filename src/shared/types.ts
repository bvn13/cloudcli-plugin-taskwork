/** DTOs shared by the plugin's frontend and its backend process. */

export interface Attachment {
  /** Host project identifier (`context.project.name` is the same value). */
  projectId: string;
  /** Snapshot of the project's display name at attach time. */
  projectName: string;
  attachedAt: string;
  /** Set once the provider session materialises; `null` means "pending". */
  sessionId: string | null;
}

export interface Task {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  attachments: Attachment[];
}

/** On-disk shape of `~/.claude-code-ui/taskwork/tasks.json`. */
export interface StoreFile {
  schemaVersion: 1;
  tasks: Task[];
}

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'PROJECT_ALREADY_ATTACHED'
  | 'INTERNAL_ERROR';

export interface ErrorBody {
  error: { code: ErrorCode; message: string };
}

export interface HealthResponse {
  status: 'ok';
  version: string;
}

export interface TasksResponse {
  tasks: Task[];
}

export interface TaskResponse {
  task: Task;
}

export interface DeletedResponse {
  deleted: true;
}

export interface LockedProjectsResponse {
  lockedProjectIds: string[];
}

export interface CreateTaskBody {
  title: string;
}

export interface RenameTaskBody {
  title: string;
}

export interface AttachProjectBody {
  projectId: string;
  projectName: string;
}

export interface SetSessionBody {
  sessionId: string;
}
