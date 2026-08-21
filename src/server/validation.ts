import type { AttachProjectBody, CreateTaskBody, SetSessionBody } from '../shared/types.js';

/** Identifiers appearing in URL paths: no traversal, no separators. */
const ID_RE = /^[A-Za-z0-9_-]+$/;

export const MAX_TITLE_LENGTH = 200;
export const MAX_PROJECT_NAME_LENGTH = 200;
export const MAX_SESSION_ID_LENGTH = 200;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && ID_RE.test(value);
}

export function requireId(value: unknown, field: string): string {
  if (!isValidId(value)) throw new ValidationError(`${field} must match [A-Za-z0-9_-]+`);
  return value;
}

function requireObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object.');
  }
  return body as Record<string, unknown>;
}

/** INV-2: non-empty after trim, at most 200 characters. */
export function requireTitle(raw: unknown): string {
  if (typeof raw !== 'string') throw new ValidationError('Title must be a string.');
  const title = raw.trim();
  if (title.length === 0) throw new ValidationError('Title must not be empty.');
  if (title.length > MAX_TITLE_LENGTH) {
    throw new ValidationError(`Title must be at most ${MAX_TITLE_LENGTH} characters.`);
  }
  return title;
}

export function parseTitleBody(body: unknown): CreateTaskBody {
  return { title: requireTitle(requireObject(body).title) };
}

export function parseAttachBody(body: unknown): AttachProjectBody {
  const source = requireObject(body);
  const projectId = requireId(source.projectId, 'projectId');

  if (typeof source.projectName !== 'string') throw new ValidationError('projectName must be a string.');
  const projectName = source.projectName.trim();
  if (projectName.length === 0) throw new ValidationError('projectName must not be empty.');
  if (projectName.length > MAX_PROJECT_NAME_LENGTH) {
    throw new ValidationError(`projectName must be at most ${MAX_PROJECT_NAME_LENGTH} characters.`);
  }

  return { projectId, projectName };
}

export function parseSessionBody(body: unknown): SetSessionBody {
  const source = requireObject(body);
  if (typeof source.sessionId !== 'string') throw new ValidationError('sessionId must be a string.');
  const sessionId = source.sessionId.trim();
  if (sessionId.length === 0) throw new ValidationError('sessionId must not be empty.');
  if (sessionId.length > MAX_SESSION_ID_LENGTH) {
    throw new ValidationError(`sessionId must be at most ${MAX_SESSION_ID_LENGTH} characters.`);
  }
  return { sessionId };
}
