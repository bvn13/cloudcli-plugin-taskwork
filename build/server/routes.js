import { ConflictError, NotFoundError, Repository } from './repository.js';
import { ValidationError, parseAttachBody, parseSessionBody, parseTitleBody, requireId, } from './validation.js';
function errorBody(code, message) {
    return { error: { code, message } };
}
function ok(body) {
    return { status: 200, body };
}
/** Path parameters are decoded, then hard-validated: `../` never reaches a handler. */
function decodeSegment(raw, field) {
    let decoded;
    try {
        decoded = decodeURIComponent(raw);
    }
    catch {
        throw new ValidationError(`${field} is not valid URL encoding`);
    }
    return requireId(decoded, field);
}
/**
 * Maps one RPC call onto the store. Transport (HTTP parsing, JSON encoding)
 * stays in index.ts so the whole contract can be tested without a socket.
 */
export async function handleRpc(options, method, pathname, body) {
    const { repository, version } = options;
    const segments = pathname.split('/').filter((segment) => segment.length > 0);
    try {
        // E1 GET /health
        if (method === 'GET' && segments.length === 1 && segments[0] === 'health') {
            return ok({ status: 'ok', version });
        }
        // E9 GET /locked-projects
        if (method === 'GET' && segments.length === 1 && segments[0] === 'locked-projects') {
            return ok({ lockedProjectIds: repository.lockedProjectIds() });
        }
        if (segments[0] === 'tasks') {
            // E2 GET /tasks
            if (method === 'GET' && segments.length === 1) {
                return ok({ tasks: repository.listTasks() });
            }
            // E3 POST /tasks
            if (method === 'POST' && segments.length === 1) {
                const { title } = parseTitleBody(body);
                return ok({ task: await repository.createTask(title) });
            }
            if (segments.length >= 2) {
                const taskId = decodeSegment(segments[1], 'taskId');
                // E4 PATCH /tasks/:taskId
                if (method === 'PATCH' && segments.length === 2) {
                    const { title } = parseTitleBody(body);
                    return ok({ task: await repository.renameTask(taskId, title) });
                }
                // E5 DELETE /tasks/:taskId
                if (method === 'DELETE' && segments.length === 2) {
                    await repository.deleteTask(taskId);
                    return ok({ deleted: true });
                }
                if (segments[2] === 'attachments') {
                    // E6 POST /tasks/:taskId/attachments
                    if (method === 'POST' && segments.length === 3) {
                        const { projectId, projectName } = parseAttachBody(body);
                        return ok({ task: await repository.attachProject(taskId, projectId, projectName) });
                    }
                    if (segments.length === 4) {
                        const projectId = decodeSegment(segments[3], 'projectId');
                        // E7 DELETE /tasks/:taskId/attachments/:projectId
                        if (method === 'DELETE') {
                            return ok({ task: await repository.detachProject(taskId, projectId) });
                        }
                        // E8 PATCH /tasks/:taskId/attachments/:projectId
                        if (method === 'PATCH') {
                            const { sessionId } = parseSessionBody(body);
                            return ok({ task: await repository.setAttachmentSession(taskId, projectId, sessionId) });
                        }
                    }
                }
            }
        }
        return { status: 404, body: errorBody('NOT_FOUND', 'Unknown endpoint.') };
    }
    catch (error) {
        if (error instanceof ValidationError) {
            return { status: 400, body: errorBody('VALIDATION_ERROR', error.message) };
        }
        if (error instanceof NotFoundError) {
            return { status: 404, body: errorBody('NOT_FOUND', error.message) };
        }
        if (error instanceof ConflictError) {
            return { status: 409, body: errorBody('PROJECT_ALREADY_ATTACHED', error.message) };
        }
        // Anything else is a bug: log the detail, expose nothing (§14).
        process.stderr.write(`[taskwork] ${method} ${pathname} failed: ${String(error)}\n`);
        return { status: 500, body: errorBody('INTERNAL_ERROR', 'Internal plugin error.') };
    }
}
