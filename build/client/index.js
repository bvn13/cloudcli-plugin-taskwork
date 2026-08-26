// Task Work plugin — generated bundle, do not edit.
// Source: src/client/**, built by scripts/build.mjs.
// SPDX-License-Identifier: AGPL-3.0-or-later

// ---- capabilities.js ----
/** The plugin API as handed over by the host, plus the parts PR-2/PR-3 add. */
/**
 * Feature detection only — never a version comparison. A host that grew the API
 * under a different name simply reads as "stock" and the plugin degrades (§6.2).
 */
function detect(api) {
    const a = api;
    const host = a?.host;
    return {
        surface: a?.surface === 'sidebar' ? 'sidebar' : 'tab',
        canFetchHost: typeof host?.fetch === 'function',
        canNavigate: typeof host?.startNewSession === 'function' &&
            typeof host?.openSession === 'function',
    };
}

// ---- host-bridge.js ----
/** The host rejected the request: the user's session is gone, retrying is pointless (§11). */
class HostAuthError extends Error {
    constructor() {
        super('Session expired — reload the page.');
        this.name = 'HostAuthError';
    }
}
class HostUnsupportedError extends Error {
    constructor(operation) {
        super(`NOT_SUPPORTED: ${operation}`);
        this.name = 'HostUnsupportedError';
    }
}
const SESSION_CACHE_TTL_MS = 30_000;
function readString(source, ...keys) {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'string' && value.length > 0)
            return value;
    }
    return null;
}
function toHostProject(raw) {
    if (typeof raw !== 'object' || raw === null)
        return null;
    const source = raw;
    const projectId = readString(source, 'projectId');
    if (!projectId)
        return null;
    return {
        projectId,
        displayName: readString(source, 'displayName') ?? projectId,
        fullPath: readString(source, 'fullPath', 'path') ?? '',
    };
}
function toHostSession(raw) {
    if (typeof raw !== 'object' || raw === null)
        return null;
    const source = raw;
    const id = readString(source, 'id');
    if (!id)
        return null;
    return {
        id,
        title: readString(source, 'title', 'summary', 'name') ?? 'Untitled session',
        createdAt: readString(source, 'createdAt', 'created_at', 'lastActivity'),
    };
}
/** Newest first; the host's own ordering is not part of any contract (§9.5.1). */
function sortByCreatedAtDesc(sessions) {
    return [...sessions].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
}
/** Full mode: everything goes through `api.host`, never through the host's localStorage (D-3). */
class HostApiBridge {
    api;
    capabilities;
    sessionCache = new Map();
    constructor(api, capabilities) {
        this.api = api;
        this.capabilities = capabilities;
    }
    invalidate() {
        this.sessionCache.clear();
    }
    async listProjects() {
        const payload = await this.get('/api/projects?skipSync=1');
        const list = Array.isArray(payload)
            ? payload
            : payload?.projects ?? [];
        return list.map(toHostProject).filter((p) => p !== null);
    }
    async listSessions(projectId, limit) {
        const cached = this.sessionCache.get(projectId);
        if (cached && Date.now() - cached.at < SESSION_CACHE_TTL_MS)
            return cached.sessions;
        const payload = await this.get(`/api/projects/${encodeURIComponent(projectId)}/sessions?limit=${limit}&offset=0`);
        const list = Array.isArray(payload)
            ? payload
            : payload?.sessions ?? [];
        const sessions = sortByCreatedAtDesc(list.map(toHostSession).filter((s) => s !== null));
        this.sessionCache.set(projectId, { at: Date.now(), sessions });
        return sessions;
    }
    async startNewSession(projectId) {
        if (!this.capabilities.canNavigate)
            throw new HostUnsupportedError('startNewSession');
        this.api.host?.startNewSession(projectId);
    }
    async openSession(projectId, sessionId) {
        if (!this.capabilities.canNavigate)
            throw new HostUnsupportedError('openSession');
        this.api.host?.openSession(projectId, sessionId);
    }
    async get(path) {
        const host = this.api.host;
        if (!host)
            throw new HostUnsupportedError(path);
        const response = await host.fetch(path);
        if (response.status === 401 || response.status === 403)
            throw new HostAuthError();
        if (!response.ok)
            throw new Error(`Host request failed (HTTP ${response.status})`);
        return response.json();
    }
}
/**
 * Stock mode: `api.context` is the only source of host data there is, and this
 * implementation performs no network request at all (§6.3, T-F7).
 */
class ContextOnlyBridge {
    api;
    capabilities;
    constructor(api, capabilities) {
        this.api = api;
        this.capabilities = capabilities;
    }
    invalidate() {
        // Nothing is cached: the context is read straight off the api object.
    }
    async listProjects() {
        const project = this.api.context.project;
        if (!project)
            return [];
        return [{
                projectId: project.name,
                displayName: basename(project.path) || project.name,
                fullPath: project.path,
            }];
    }
    async listSessions() {
        return [];
    }
    async startNewSession() {
        throw new HostUnsupportedError('startNewSession');
    }
    async openSession() {
        throw new HostUnsupportedError('openSession');
    }
}
/** Last path segment of a full project path — the host's display name is out of reach in stock mode. */
function basename(fullPath) {
    const parts = fullPath.split(/[\\/]/).filter((part) => part.length > 0);
    return parts[parts.length - 1] ?? '';
}
function createBridge(api, capabilities) {
    return capabilities.canFetchHost
        ? new HostApiBridge(api, capabilities)
        : new ContextOnlyBridge(api, capabilities);
}

// ---- store.js ----
const EXPANDED_KEY = 'taskwork:expanded';
/**
 * The host's `rpc()` throws `RPC error <status>` and swallows the response body,
 * so the status code is all a plugin gets to distinguish a conflict from a
 * genuine failure (PluginTabContent.tsx).
 */
function rpcStatus(error) {
    const message = error instanceof Error ? error.message : String(error);
    const match = /RPC error (\d{3})/.exec(message);
    return match ? Number(match[1]) : null;
}
function bannerFor(error) {
    const status = rpcStatus(error);
    if (status === 503)
        return 'Task Work server is not running.';
    if (status === 400)
        return 'The server rejected the request.';
    return 'Task Work server is not reachable.';
}
/** Reads the persisted expansion set; a broken value must never break the tree. */
function readExpanded() {
    try {
        const raw = localStorage.getItem(EXPANDED_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []);
    }
    catch {
        return new Set();
    }
}
class TaskStore {
    api;
    state = { status: 'loading', tasks: [], lockedProjectIds: [], banner: null };
    listeners = new Set();
    expanded = readExpanded();
    disposed = false;
    constructor(api) {
        this.api = api;
    }
    getState() {
        return this.state;
    }
    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    dispose() {
        this.disposed = true;
        this.listeners.clear();
    }
    isExpanded(taskId) {
        return this.expanded.has(taskId);
    }
    toggleExpanded(taskId, expanded) {
        const next = expanded ?? !this.expanded.has(taskId);
        if (next)
            this.expanded.add(taskId);
        else
            this.expanded.delete(taskId);
        try {
            localStorage.setItem(EXPANDED_KEY, JSON.stringify([...this.expanded]));
        }
        catch {
            // Storage disabled or full — expansion simply stops being sticky.
        }
        this.emit();
    }
    isProjectLocked(projectId) {
        return this.state.lockedProjectIds.includes(projectId);
    }
    async loadTasks() {
        this.patch({ status: this.state.tasks.length > 0 ? this.state.status : 'loading' });
        try {
            const [tasks, locked] = await Promise.all([
                this.api.rpc('GET', '/tasks'),
                this.api.rpc('GET', '/locked-projects'),
            ]);
            this.patch({
                status: 'ready',
                tasks: tasks.tasks ?? [],
                lockedProjectIds: locked.lockedProjectIds ?? [],
                banner: null,
            });
        }
        catch (error) {
            this.patch({ status: 'error', banner: bannerFor(error) });
        }
    }
    async refreshLocks() {
        try {
            const locked = await this.api.rpc('GET', '/locked-projects');
            this.patch({ lockedProjectIds: locked.lockedProjectIds ?? [] });
        }
        catch {
            // Non-fatal: the backend stays the source of truth and will reject a stale attach.
        }
    }
    createTask(title) {
        return this.mutate('POST', '/tasks', { title });
    }
    renameTask(taskId, title) {
        return this.mutate('PATCH', `/tasks/${encodeURIComponent(taskId)}`, { title });
    }
    async deleteTask(taskId) {
        try {
            await this.api.rpc('DELETE', `/tasks/${encodeURIComponent(taskId)}`);
            await this.loadTasks();
            return true;
        }
        catch (error) {
            this.patch({ banner: bannerFor(error) });
            return false;
        }
    }
    attachProject(taskId, projectId, projectName) {
        return this.mutate('POST', `/tasks/${encodeURIComponent(taskId)}/attachments`, { projectId, projectName });
    }
    /**
     * Pins the session an attachment ended up with (E8). Deliberately does not
     * re-read the tree: this fires from the session poll, and a full reload there
     * would fight with whatever the user is doing.
     */
    async bindSession(taskId, projectId, sessionId) {
        try {
            const response = await this.api.rpc('PATCH', `/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(projectId)}`, { sessionId });
            const task = response.task;
            this.patch({ tasks: this.state.tasks.map((candidate) => (candidate.id === task.id ? task : candidate)) });
        }
        catch {
            // Non-fatal: the attachment stays unbound and the heuristic runs again.
        }
    }
    detachProject(taskId, projectId) {
        return this.mutate('DELETE', `/tasks/${encodeURIComponent(taskId)}/attachments/${encodeURIComponent(projectId)}`);
    }
    /** Every mutation re-reads the tree: two surfaces and two browser tabs stay in step (§11). */
    async mutate(method, path, body) {
        try {
            const response = await this.api.rpc(method, path, body);
            await this.loadTasks();
            return { ok: true, task: response.task };
        }
        catch (error) {
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
    setBanner(banner) {
        this.patch({ banner });
    }
    patch(partial) {
        if (this.disposed)
            return;
        this.state = { ...this.state, ...partial };
        this.emit();
    }
    emit() {
        if (this.disposed)
            return;
        for (const listener of this.listeners) {
            try {
                listener(this.state);
            }
            catch {
                // A broken view must not take the others down with it.
            }
        }
    }
}

// ---- styles.js ----
const STYLE_ID = 'taskwork-styles';
/**
 * The look is deliberately borrowed from the host's own project list, so the
 * task tree reads as part of the sidebar rather than as an embedded widget:
 * the same row padding, radius, hover accent, left rail under a parent node and
 * the same primary-coloured action button.
 *
 * The host publishes its palette as **raw HSL triples** (`--accent: 44 15% 91%`),
 * not as finished colours, so every reference has to go through
 * `hsl(var(--x) / a)` with a triple as the fallback. Using `var(--accent)`
 * directly yields an invalid colour and the element silently renders unstyled.
 */
const CSS = `
.tw-root {
  --tw-fg: hsl(var(--foreground, 0 0% 10%));
  --tw-muted: hsl(var(--muted-foreground, 0 0% 45%));
  --tw-border: hsl(var(--border, 0 0% 85%));
  --tw-accent: hsl(var(--accent, 0 0% 92%));
  --tw-accent-soft: hsl(var(--accent, 0 0% 92%) / 0.5);
  --tw-accent-fg: hsl(var(--accent-foreground, 0 0% 10%));
  --tw-primary: hsl(var(--primary, 221 83% 53%));
  --tw-primary-hover: hsl(var(--primary, 221 83% 53%) / 0.9);
  --tw-primary-fg: hsl(var(--primary-foreground, 0 0% 100%));
  --tw-danger: hsl(var(--destructive, 0 84% 60%));
  --tw-ring: hsl(var(--ring, 221 83% 53%));

  display: flex;
  flex-direction: column;
  gap: 4px;
  box-sizing: border-box;
  height: 100%;
  overflow: auto;
  padding: 8px 6px;
  color: var(--tw-fg);
  font-size: 14px;
  line-height: 1.35;
}
.tw-root *, .tw-root *::before, .tw-root *::after { box-sizing: border-box; }
.tw-root :focus-visible { outline: 2px solid var(--tw-ring); outline-offset: 1px; }

.tw-surface-tab { max-width: 720px; margin: 0 auto; padding: 16px; }

/* ── banners ─────────────────────────────────────────────────────────── */
.tw-banner {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin: 0 2px 4px; padding: 6px 10px;
  border: 1px solid var(--tw-border); border-radius: 8px;
  color: var(--tw-muted); font-size: 12px;
}
.tw-banner-error { color: var(--tw-fg); border-color: var(--tw-danger); }

/* ── buttons ─────────────────────────────────────────────────────────── */
.tw-button {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  height: 32px; padding: 0 10px;
  border: none; border-radius: 6px;
  background: var(--tw-primary); color: var(--tw-primary-fg);
  font: inherit; font-size: 12px; font-weight: 500;
  cursor: pointer; transition: background-color .15s;
}
.tw-button:hover:not(:disabled) { background: var(--tw-primary-hover); }
.tw-button:active:not(:disabled) { transform: scale(.98); }
.tw-button:disabled { opacity: .5; cursor: not-allowed; }
.tw-button-wide { width: 100%; }
.tw-button-quiet {
  background: transparent; color: var(--tw-fg);
  border: 1px solid var(--tw-border); font-weight: 400;
}
.tw-button-quiet:hover:not(:disabled) { background: var(--tw-accent-soft); }

/* ── tree ────────────────────────────────────────────────────────────── */
.tw-tree { display: flex; flex-direction: column; gap: 2px; }
.tw-group {
  display: flex; flex-direction: column; gap: 2px;
  margin: 2px 0 2px 12px; padding-left: 12px;
  border-left: 1px solid var(--tw-border);
}

.tw-node {
  display: flex; align-items: center; gap: 10px;
  width: 100%; padding: 8px; border-radius: 6px;
  background: transparent; text-align: left;
  cursor: pointer; transition: background-color .15s;
}
.tw-node:hover { background: var(--tw-accent-soft); }
.tw-node[aria-selected="true"] { background: var(--tw-accent); color: var(--tw-accent-fg); }
.tw-node-attachment { padding: 6px 8px; }
.tw-node-attachment[data-clickable="false"] { cursor: default; }
.tw-node-removed .tw-node-title { color: var(--tw-muted); text-decoration: line-through; }

.tw-node-icon {
  display: flex; align-items: center; justify-content: center;
  flex: 0 0 24px; width: 24px; height: 24px; border-radius: 4px;
  color: var(--tw-muted);
}
.tw-node-attachment .tw-node-icon {
  flex-basis: 20px; width: 20px; height: 20px;
  background: hsl(var(--muted, 0 0% 96%) / 0.6);
}
.tw-svg { width: 14px; height: 14px; }
.tw-node-attachment .tw-svg { width: 12px; height: 12px; }

.tw-node-text { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; }
.tw-node-title {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 14px; font-weight: 400; color: var(--tw-fg);
}
.tw-node-attachment .tw-node-title { font-size: 13px; }
.tw-node-subtitle {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12px; color: var(--tw-muted);
}
.tw-node-input {
  flex: 1 1 auto; min-width: 0;
  padding: 5px 8px; border: 2px solid hsl(var(--primary, 221 83% 53%) / 0.4); border-radius: 6px;
  background: hsl(var(--background, 0 0% 100%)); color: var(--tw-fg);
  font: inherit; font-size: 14px;
}
.tw-node-input:focus { border-color: var(--tw-primary); outline: none; }

.tw-age {
  flex: 0 0 auto; color: var(--tw-muted);
  font-size: 11px; font-variant-numeric: tabular-nums;
}
.tw-chevron {
  display: flex; align-items: center; justify-content: center;
  flex: 0 0 24px; width: 24px; height: 24px; border-radius: 4px;
  border: none; background: transparent; color: var(--tw-muted); cursor: pointer; padding: 0;
}
.tw-chevron:hover { background: var(--tw-accent); }

.tw-icon {
  display: flex; align-items: center; justify-content: center;
  flex: 0 0 24px; width: 24px; height: 24px; padding: 0;
  border: none; border-radius: 4px; background: transparent;
  color: var(--tw-muted); cursor: pointer;
  opacity: 0; transition: opacity .2s, background-color .15s;
}
.tw-node:hover .tw-icon, .tw-icon:focus-visible { opacity: 1; }
.tw-icon:hover { background: var(--tw-accent); color: var(--tw-fg); }
.tw-icon-danger:hover { color: var(--tw-danger); }

/* ── states ──────────────────────────────────────────────────────────── */
.tw-hint, .tw-empty, .tw-error { color: var(--tw-muted); font-size: 12px; padding: 8px; }
.tw-empty { text-align: center; padding: 24px 8px; }
.tw-error { color: var(--tw-danger); }

.tw-confirm {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin: 2px 0 2px 24px; padding: 8px 10px;
  border: 1px solid var(--tw-border); border-radius: 8px;
  background: hsl(var(--muted, 0 0% 96%) / 0.4);
  font-size: 12px;
}
.tw-confirm span { flex: 1 1 auto; min-width: 120px; }
.tw-confirm .tw-button { height: 28px; }

/* ── project picker ──────────────────────────────────────────────────── */
.tw-picker { display: flex; flex-direction: column; gap: 4px; padding: 2px 0; }
.tw-listbox {
  display: flex; flex-direction: column; gap: 2px;
  max-height: 240px; overflow: auto; padding: 4px;
  border: 1px solid var(--tw-border); border-radius: 8px;
  background: hsl(var(--popover, var(--background, 0 0% 100%)));
  box-shadow: 0 4px 12px hsl(0 0% 0% / .12);
}
.tw-option {
  display: flex; align-items: center; gap: 8px;
  width: 100%; min-height: 32px; padding: 6px 8px;
  border: none; border-radius: 6px; background: transparent;
  color: var(--tw-fg); font: inherit; font-size: 13px; text-align: left; cursor: pointer;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tw-option:hover, .tw-option[aria-selected="true"] { background: var(--tw-accent-soft); }
.tw-option[aria-disabled="true"] { color: var(--tw-muted); cursor: not-allowed; }
`;
/** Idempotent: the module may be mounted into two surfaces at once (§6.5). */
function injectStyles() {
    const existing = document.getElementById(STYLE_ID);
    if (existing) {
        // Keep the newest rules when a rebuilt module is mounted into a live page.
        existing.textContent = CSS;
        return;
    }
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
}

// ---- age.js ----
/**
 * Compact age badge, byte-for-byte compatible with the host's own sidebar
 * formatter (`src/components/sidebar/utils/utils.ts`): `<1m`, `Nm`, `Nhr`, `Nd`.
 */
const formatCompactAge = (iso, now) => {
    if (!iso)
        return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime()))
        return '';
    const minutes = Math.floor(Math.max(0, now.getTime() - date.getTime()) / 60000);
    if (minutes < 1)
        return '<1m';
    if (minutes < 60)
        return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return hours < 24 ? `${hours}hr` : `${Math.floor(hours / 24)}d`;
};

// ---- dom.js ----
/**
 * Minimal DOM helpers. User-provided strings are always assigned through
 * `textContent`; `innerHTML` is never used anywhere in the client (§11, §14).
 */
function el(tag, options = {}) {
    const node = document.createElement(tag);
    if (options.className)
        node.className = options.className;
    if (options.text !== undefined)
        node.textContent = options.text;
    if (options.title !== undefined)
        node.title = options.title;
    for (const [name, value] of Object.entries(options.attrs ?? {}))
        node.setAttribute(name, value);
    for (const child of options.children ?? [])
        if (child)
            node.appendChild(child);
    return node;
}
/** Icon-sized button with an accessible name (minimum hit area comes from CSS). */
function iconButton(className, label, glyph) {
    const button = el('button', {
        className,
        attrs: { type: 'button', 'aria-label': label, title: label },
    });
    button.appendChild(typeof glyph === 'string' ? document.createTextNode(glyph) : glyph);
    return button;
}
const SVG_NS = 'http://www.w3.org/2000/svg';
/**
 * Inline icon in the host's icon style (lucide: 24×24 grid, `currentColor`,
 * 2px round strokes). Built through the DOM rather than `innerHTML`.
 */
function icon(paths, className = 'tw-svg') {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', className);
    for (const definition of paths) {
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', definition);
        svg.appendChild(path);
    }
    return svg;
}
const ICON_CHEVRON_RIGHT = ['m9 18 6-6-6-6'];
const ICON_CHEVRON_DOWN = ['m6 9 6 6 6-6'];
const ICON_PLUS = ['M5 12h14', 'M12 5v14'];
const ICON_TRASH = ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'];
// The host's rename affordance is lucide `Edit3` (`pen-line`) — the same glyph here.
const ICON_PENCIL = [
    'M12 20h9',
    'M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z',
];
const ICON_MESSAGE = ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'];
const ICON_FOLDER = ['M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'];
const ICON_LIST = ['m3 5 2 2 4-4', 'M13 6h8', 'M13 12h8', 'M13 18h8', 'm3 13 2 2 4-4'];
function focusSoon(input) {
    // rAF: the element has to be in the document and laid out before focus sticks.
    requestAnimationFrame(() => {
        input.focus();
        input.select();
    });
}

// ---- AddTaskButton.js ----
/**
 * Sits where the host's search box would be (§9.2) and starts a draft task.
 * Styled like the host's own primary action button so the section opens with a
 * familiar affordance. Pressing it again while a draft is open replaces that
 * draft (§9.3, step 6).
 */
function createAddTaskButton(onStartDraft) {
    const button = el('button', {
        className: 'tw-button tw-button-wide',
        attrs: { type: 'button', 'aria-label': 'Add new task' },
        children: [icon(ICON_PLUS), el('span', { text: 'Add new task' })],
    });
    button.addEventListener('click', () => onStartDraft());
    return el('div', { className: 'tw-toolbar', children: [button] });
}

// ---- AttachmentNode.js ----
/**
 * A child node of a task: one attached project, with its session underneath —
 * laid out like the host's own session rows. What the subtitle says and whether
 * the row is clickable depends on the host's capabilities, never on a guess
 * (§9.5.1).
 */
function createAttachmentNode(context, task, attachment) {
    const view = context.describeAttachment(task, attachment);
    const nodeId = `att:${task.id}:${attachment.projectId}`;
    const row = el('div', {
        className: `tw-node tw-node-attachment${view.removed ? ' tw-node-removed' : ''}`,
        attrs: {
            role: 'treeitem',
            'aria-label': view.label,
            'data-node-id': nodeId,
            'data-task-id': task.id,
            'data-project-id': attachment.projectId,
            'data-state': view.pending ? 'pending' : 'ready',
            'data-clickable': String(view.clickable),
            tabindex: context.view.activeNodeId === nodeId ? '0' : '-1',
        },
        children: [
            el('span', { className: 'tw-node-icon', children: [icon(ICON_MESSAGE)] }),
            el('div', {
                className: 'tw-node-text',
                children: [
                    el('div', { className: 'tw-node-title', text: view.projectName, title: view.projectName }),
                    el('div', { className: 'tw-node-subtitle', text: view.sessionLabel, title: view.sessionLabel }),
                ],
            }),
        ],
    });
    const detach = iconButton('tw-icon tw-icon-danger', `Detach ${attachment.projectName}`, icon(ICON_TRASH));
    detach.addEventListener('click', (event) => {
        event.stopPropagation();
        context.callbacks.requestDelete({ kind: 'attachment', taskId: task.id, projectId: attachment.projectId });
    });
    row.appendChild(detach);
    if (view.clickable) {
        row.addEventListener('click', () => context.callbacks.activateAttachment(task.id, attachment.projectId));
    }
    return row;
}

// ---- TaskNode.js ----
const AGE_ATTR = 'data-created-at';
/**
 * Inline editor shared by the draft node and by rename (§9.3, §9.4).
 *
 * `Enter` commits and `Escape` cancels; the difference between the two is what
 * `blur` means — a draft is dropped, a rename is saved. Committing moves focus,
 * which fires `blur`, so a guard flag keeps that from running the other branch.
 */
function createInlineInput(options) {
    const input = el('input', {
        className: 'tw-node-input',
        attrs: { type: 'text', placeholder: options.placeholder, 'aria-label': options.placeholder },
    });
    input.value = options.value;
    input.disabled = options.busy;
    let settled = false;
    const settle = (action) => {
        if (settled)
            return;
        settled = true;
        action();
    };
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            settle(() => options.onCommit(input.value));
        }
        else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            settle(options.onCancel);
        }
    });
    input.addEventListener('blur', () => settle(() => options.onBlur(input.value)));
    if (!options.busy)
        focusSoon(input);
    return input;
}
/** Subtitle under a task title, mirroring the project row's session count. */
function attachmentSummary(task) {
    const count = task.attachments.length;
    if (count === 0)
        return 'No projects';
    return count === 1 ? '1 project' : `${count} projects`;
}
/** The unsaved task row: it lives directly under the `+` button until Enter or blur. */
function createDraftNode(context) {
    const input = createInlineInput({
        value: '',
        placeholder: 'Task name',
        busy: context.view.draftBusy,
        onCommit: (value) => context.callbacks.commitDraft(value),
        onCancel: () => context.callbacks.cancelDraft(),
        // Losing focus with the mouse discards the draft — required behaviour, not a shortcut.
        onBlur: () => context.callbacks.cancelDraft(),
    });
    const row = el('div', {
        className: 'tw-node tw-node-task tw-node-draft',
        children: [
            el('span', { className: 'tw-node-icon', children: [icon(ICON_LIST)] }),
            input,
        ],
    });
    return el('div', {
        children: [
            row,
            context.view.draftError ? el('div', { className: 'tw-error', text: context.view.draftError }) : null,
        ],
    });
}
function createTaskNode(context, task, now) {
    const expanded = context.store.isExpanded(task.id);
    const editing = context.view.editingTaskId === task.id;
    const row = el('div', {
        className: 'tw-node tw-node-task',
        attrs: {
            role: 'treeitem',
            'aria-expanded': String(expanded),
            'aria-label': task.title,
            'data-node-id': `task:${task.id}`,
            'data-task-id': task.id,
            tabindex: context.view.activeNodeId === `task:${task.id}` ? '0' : '-1',
        },
    });
    row.appendChild(el('span', { className: 'tw-node-icon', children: [icon(ICON_LIST)] }));
    if (editing) {
        row.appendChild(createInlineInput({
            value: task.title,
            placeholder: 'Task name',
            busy: false,
            onCommit: (value) => context.callbacks.commitRename(task.id, value),
            onCancel: () => context.callbacks.cancelRename(),
            // Rename saves on blur; a draft discards. Same widget, deliberately different (§9.4).
            onBlur: (value) => context.callbacks.commitRename(task.id, value),
        }));
    }
    else {
        const title = el('div', { className: 'tw-node-title', text: task.title, title: task.title });
        const text = el('div', {
            className: 'tw-node-text',
            children: [title, el('div', { className: 'tw-node-subtitle', text: attachmentSummary(task) })],
        });
        text.addEventListener('dblclick', (event) => {
            event.stopPropagation();
            context.callbacks.startRename(task.id);
        });
        row.appendChild(text);
        const age = el('span', { className: 'tw-age', text: formatCompactAge(task.createdAt, now) });
        age.setAttribute(AGE_ATTR, task.createdAt);
        row.appendChild(age);
        // Pencil then trash, in the host's own order for a project row.
        const rename = iconButton('tw-icon', `Rename task ${task.title}`, icon(ICON_PENCIL));
        rename.addEventListener('click', (event) => {
            event.stopPropagation();
            context.callbacks.startRename(task.id);
        });
        row.appendChild(rename);
        const remove = iconButton('tw-icon tw-icon-danger', `Delete task ${task.title}`, icon(ICON_TRASH));
        remove.addEventListener('click', (event) => {
            event.stopPropagation();
            context.callbacks.requestDelete({ kind: 'task', taskId: task.id });
        });
        row.appendChild(remove);
        row.appendChild(el('span', {
            className: 'tw-chevron',
            attrs: { 'aria-hidden': 'true' },
            children: [icon(expanded ? ICON_CHEVRON_DOWN : ICON_CHEVRON_RIGHT)],
        }));
        row.addEventListener('click', () => context.callbacks.toggle(task.id));
    }
    return row;
}

// ---- ProjectPicker.js ----
/** Projects are offered by their display name, never by path (§9.6, step 4). */
function sortProjectsByDisplayName(projects) {
    return [...projects].sort((a, b) => a.displayName.localeCompare(b.displayName, 'en', { sensitivity: 'base' }));
}
/** A project belongs to at most one task, so taken ones are not even offered (INV-3). */
function availableProjects(projects, lockedProjectIds) {
    const locked = new Set(lockedProjectIds);
    return sortProjectsByDisplayName(projects.filter((project) => !locked.has(project.projectId)));
}
function pickerError(message) {
    return message ? el('div', { className: 'tw-error', text: message }) : null;
}
/**
 * Stock mode has no way to enumerate the host's projects, so the picker
 * collapses into a single action on the currently selected one (§6.3).
 */
function createAttachCurrentButton(context, task) {
    const project = context.currentProject;
    const projectId = project?.name ?? null;
    const locked = projectId !== null && context.state.lockedProjectIds.includes(projectId);
    const displayName = context.currentProjectName;
    const button = el('button', {
        className: 'tw-button tw-button-wide',
        attrs: { type: 'button', 'data-role': 'attach-current' },
        children: [
            icon(ICON_PLUS),
            el('span', { text: project ? `Attach “${displayName}”` : 'Attach current project' }),
        ],
    });
    const hint = !project
        ? 'Select a project first'
        : locked
            ? 'This project is already used by another task'
            : null;
    button.disabled = hint !== null;
    if (hint)
        button.title = hint;
    if (project && !locked) {
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            context.callbacks.attach(task.id, {
                projectId: project.name,
                displayName,
                fullPath: project.path,
            });
        });
    }
    return el('div', {
        className: 'tw-picker',
        children: [
            button,
            hint ? el('div', { className: 'tw-hint', text: hint }) : null,
            pickerError(context.view.pickerError),
        ],
    });
}
function createListbox(context, task) {
    const options = availableProjects(context.projects, context.state.lockedProjectIds);
    const listbox = el('div', {
        className: 'tw-listbox',
        attrs: { role: 'listbox', 'aria-label': 'Attach a project', tabindex: '-1' },
    });
    if (options.length === 0) {
        listbox.appendChild(el('div', {
            className: 'tw-option',
            text: 'No available projects',
            attrs: { role: 'option', 'aria-disabled': 'true' },
        }));
    }
    for (const project of options) {
        const option = el('button', {
            className: 'tw-option',
            title: project.fullPath || project.displayName,
            attrs: { type: 'button', role: 'option', 'aria-selected': 'false' },
            children: [icon(ICON_FOLDER), el('span', { text: project.displayName })],
        });
        option.addEventListener('click', (event) => {
            event.stopPropagation();
            context.callbacks.attach(task.id, project);
        });
        listbox.appendChild(option);
    }
    listbox.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            context.callbacks.closePicker();
        }
    });
    // Leaving the drop-down by keyboard closes it too; a click outside is handled
    // by the single document-level listener owned by the instance (§10).
    listbox.addEventListener('focusout', (event) => {
        const next = event.relatedTarget;
        if (next && listbox.contains(next))
            return;
        context.callbacks.closePicker();
    });
    const first = listbox.querySelector('button');
    if (first instanceof HTMLElement)
        requestAnimationFrame(() => first.focus());
    return el('div', { className: 'tw-picker', children: [listbox, pickerError(context.view.pickerError)] });
}
/**
 * Renders the "attach a project" affordance for one task: a button that turns
 * into a drop-down in full mode, a single button in stock mode.
 */
function createProjectPicker(context, task) {
    if (!context.caps.canFetchHost)
        return createAttachCurrentButton(context, task);
    if (context.view.pickerTaskId !== task.id) {
        const button = el('button', {
            className: 'tw-button tw-button-wide',
            attrs: { type: 'button', 'data-role': 'add-project' },
            children: [icon(ICON_PLUS), el('span', { text: 'Add project' })],
        });
        button.addEventListener('click', (event) => {
            event.stopPropagation();
            context.callbacks.openPicker(task.id);
        });
        return el('div', {
            className: 'tw-picker',
            children: [button, pickerError(context.view.pickerError)],
        });
    }
    return createListbox(context, task);
}

// ---- TaskTree.js ----
const STOCK_MODE_BANNER = 'Limited mode — update CloudCLI to enable the project picker.';
function createBanner(text, isError, onRetry) {
    const banner = el('div', {
        className: `tw-banner${isError ? ' tw-banner-error' : ''}`,
        attrs: isError ? { role: 'alert' } : {},
        children: [el('span', { text })],
    });
    if (onRetry) {
        const retry = el('button', { className: 'tw-button', text: 'Retry', attrs: { type: 'button' } });
        retry.addEventListener('click', onRetry);
        banner.appendChild(retry);
    }
    return banner;
}
/** Deletion is confirmed in-place; `window.confirm` is not used anywhere (§9.4). */
function createConfirmRow(context, target, text) {
    const confirm = el('button', { className: 'tw-button', text: 'Delete', attrs: { type: 'button' } });
    confirm.addEventListener('click', (event) => {
        event.stopPropagation();
        context.callbacks.confirmDelete(target);
    });
    const cancel = el('button', { className: 'tw-button tw-button-quiet', text: 'Cancel', attrs: { type: 'button' } });
    cancel.addEventListener('click', (event) => {
        event.stopPropagation();
        context.callbacks.cancelDelete();
    });
    requestAnimationFrame(() => confirm.focus());
    return el('div', {
        className: 'tw-confirm',
        attrs: { role: 'group', 'aria-label': text },
        children: [el('span', { text }), confirm, cancel],
    });
}
function sameTarget(a, b) {
    return a !== null && a.kind === b.kind && a.taskId === b.taskId && a.projectId === b.projectId;
}
function createTaskGroup(context, task) {
    const group = el('div', { className: 'tw-group', attrs: { role: 'group' } });
    for (const attachment of task.attachments) {
        group.appendChild(createAttachmentNode(context, task, attachment));
        const target = { kind: 'attachment', taskId: task.id, projectId: attachment.projectId };
        if (sameTarget(context.view.confirm, target)) {
            group.appendChild(createConfirmRow(context, target, `Detach “${attachment.projectName}”?`));
        }
    }
    // Attaching is only offered on a saved task — a draft has no id to attach to.
    group.appendChild(createProjectPicker(context, task));
    return group;
}
function renderTree(root, context) {
    const now = new Date();
    const children = [];
    if (context.state.banner) {
        children.push(createBanner(context.state.banner, true, () => context.callbacks.retry()));
    }
    else if (!context.caps.canFetchHost) {
        children.push(createBanner(STOCK_MODE_BANNER, false));
    }
    children.push(createAddTaskButton(() => context.callbacks.startDraft()));
    const tree = el('div', {
        className: 'tw-tree',
        attrs: { role: 'tree', 'aria-label': 'Tasks' },
    });
    if (context.view.draft)
        tree.appendChild(createDraftNode(context));
    if (context.state.status === 'loading' && context.state.tasks.length === 0) {
        tree.appendChild(el('div', { className: 'tw-hint', text: 'Loading tasks…' }));
    }
    else if (context.state.status === 'error' && context.state.tasks.length === 0) {
        tree.appendChild(el('div', { className: 'tw-error', text: 'Failed to load tasks.' }));
    }
    else if (context.state.tasks.length === 0 && !context.view.draft) {
        tree.appendChild(el('div', { className: 'tw-empty', text: 'No tasks yet. Click + to create one.' }));
    }
    for (const task of context.state.tasks) {
        tree.appendChild(createTaskNode(context, task, now));
        const target = { kind: 'task', taskId: task.id };
        if (sameTarget(context.view.confirm, target)) {
            tree.appendChild(createConfirmRow(context, target, `Delete “${task.title}” and detach its projects?`));
        }
        if (context.store.isExpanded(task.id))
            tree.appendChild(createTaskGroup(context, task));
    }
    children.push(tree);
    root.replaceChildren(...children.filter((node) => node !== null));
    ensureActiveNode(root, context);
}
/** Keeps exactly one treeitem tabbable, falling back to the first one. */
function ensureActiveNode(root, context) {
    const nodes = visibleNodes(root);
    if (nodes.length === 0)
        return;
    const active = nodes.find((node) => node.dataset.nodeId === context.view.activeNodeId) ?? nodes[0];
    if (!active)
        return;
    for (const node of nodes)
        node.tabIndex = node === active ? 0 : -1;
}
function visibleNodes(root) {
    return [...root.querySelectorAll('[role="treeitem"]')];
}
/** Refreshes every age badge in place — no re-render, no lost focus (§9.4). */
function updateAges(root, now) {
    for (const badge of root.querySelectorAll(`[${AGE_ATTR}]`)) {
        badge.textContent = formatCompactAge(badge.getAttribute(AGE_ATTR), now);
    }
}
/**
 * Tree keyboard model (§9.8): ↑/↓ walk visible nodes, →/← expand and collapse,
 * Enter activates, F2 renames, Delete asks for confirmation.
 */
function handleTreeKeydown(event, root, context) {
    const target = event.target?.closest('[role="treeitem"]');
    if (!target)
        return;
    const nodes = visibleNodes(root);
    const index = nodes.indexOf(target);
    const nodeId = target.dataset.nodeId ?? '';
    const taskId = target.dataset.taskId ?? '';
    const projectId = target.dataset.projectId;
    const isTask = nodeId.startsWith('task:');
    const focusAt = (next) => {
        const node = nodes[Math.max(0, Math.min(nodes.length - 1, next))];
        if (!node)
            return;
        event.preventDefault();
        for (const other of nodes)
            other.tabIndex = other === node ? 0 : -1;
        node.focus();
        context.callbacks.setActiveNode(node.dataset.nodeId ?? '');
    };
    switch (event.key) {
        case 'ArrowDown':
            focusAt(index + 1);
            break;
        case 'ArrowUp':
            focusAt(index - 1);
            break;
        case 'ArrowRight':
            if (isTask && !context.store.isExpanded(taskId)) {
                event.preventDefault();
                context.callbacks.toggle(taskId);
            }
            else {
                focusAt(index + 1);
            }
            break;
        case 'ArrowLeft':
            if (isTask && context.store.isExpanded(taskId)) {
                event.preventDefault();
                context.callbacks.toggle(taskId);
            }
            else if (!isTask) {
                focusAt(nodes.findIndex((node) => node.dataset.nodeId === `task:${taskId}`));
            }
            break;
        case 'Enter':
            event.preventDefault();
            if (isTask)
                context.callbacks.toggle(taskId);
            else if (projectId)
                context.callbacks.activateAttachment(taskId, projectId);
            break;
        case 'F2':
            if (isTask) {
                event.preventDefault();
                context.callbacks.startRename(taskId);
            }
            break;
        case 'Delete':
            event.preventDefault();
            context.callbacks.requestDelete(isTask ? { kind: 'task', taskId } : { kind: 'attachment', taskId, projectId });
            break;
        default:
            break;
    }
}

// ---- index.js ----
const AGE_TICK_MS = 60_000;
// Per-container state: the same module may be mounted into the tab and the
// sidebar at the same time, so nothing mutable may live at module level (§6.5).
const instances = new WeakMap();
function initialView() {
    return {
        draft: false,
        draftBusy: false,
        draftError: null,
        editingTaskId: null,
        confirm: null,
        pickerTaskId: null,
        pickerError: null,
        activeNodeId: null,
    };
}
function applyTheme(instance, context) {
    const dark = context.theme !== 'light';
    instance.root.classList.toggle('tw-theme-dark', dark);
    instance.root.classList.toggle('tw-theme-light', !dark);
}
function currentProjectName(instance) {
    const project = instance.api.context.project;
    if (!project)
        return '';
    const known = instance.projects.find((candidate) => candidate.projectId === project.name);
    return known?.displayName ?? basename(project.path) ?? project.name;
}
function view(projectName, sessionLabel, rest) {
    return { projectName, sessionLabel, label: `${projectName} — ${sessionLabel}`, ...rest };
}
function describeAttachment(instance, _task, attachment) {
    const known = instance.projects.find((project) => project.projectId === attachment.projectId);
    // A renamed project shows its current name; the snapshot is only a fallback (§11).
    const name = known?.displayName ?? attachment.projectName;
    if (!instance.caps.canFetchHost) {
        return view(name, 'Open in Chat', { clickable: false, pending: false, removed: false });
    }
    if (instance.projectsLoaded && !known) {
        return view(name, 'Project removed', { clickable: false, pending: false, removed: true });
    }
    if (!instance.sessions.has(attachment.projectId)) {
        return view(name, '…', { clickable: false, pending: false, removed: false });
    }
    const session = instance.sessions.get(attachment.projectId) ?? null;
    if (!session) {
        return view(name, 'New chat', { clickable: instance.caps.canNavigate, pending: true, removed: false });
    }
    return view(name, session.title, { clickable: instance.caps.canNavigate, pending: false, removed: false });
}
/** One description of the surface, shared by rendering and by the keyboard handler. */
function treeContext(instance) {
    return {
        state: instance.store.getState(),
        view: instance.view,
        caps: instance.caps,
        store: instance.store,
        projects: instance.projects,
        currentProject: instance.api.context.project,
        currentProjectName: currentProjectName(instance),
        describeAttachment: (task, attachment) => describeAttachment(instance, task, attachment),
        callbacks: {
            startDraft: () => {
                instance.view = { ...instance.view, draft: true, draftError: null, draftBusy: false };
                render(instance);
            },
            cancelDraft: () => {
                if (!instance.view.draft)
                    return;
                instance.view = { ...instance.view, draft: false, draftError: null, draftBusy: false };
                render(instance);
            },
            commitDraft: (title) => { void commitDraft(instance, title); },
            toggle: (taskId) => instance.store.toggleExpanded(taskId),
            startRename: (taskId) => {
                instance.view = { ...instance.view, editingTaskId: taskId };
                render(instance);
            },
            commitRename: (taskId, title) => { void commitRename(instance, taskId, title); },
            cancelRename: () => {
                instance.view = { ...instance.view, editingTaskId: null };
                render(instance);
            },
            requestDelete: (target) => {
                instance.view = { ...instance.view, confirm: target };
                render(instance);
            },
            confirmDelete: (target) => { void confirmDelete(instance, target); },
            cancelDelete: () => {
                instance.view = { ...instance.view, confirm: null };
                render(instance);
            },
            openPicker: (taskId) => {
                instance.view = { ...instance.view, pickerTaskId: taskId, pickerError: null };
                render(instance);
            },
            closePicker: () => {
                if (instance.view.pickerTaskId === null)
                    return;
                instance.view = { ...instance.view, pickerTaskId: null };
                render(instance);
            },
            attach: (taskId, project) => { void attachProject(instance, taskId, project); },
            activateAttachment: (taskId, projectId) => { void activateAttachment(instance, taskId, projectId); },
            setActiveNode: (nodeId) => { instance.view.activeNodeId = nodeId; },
            retry: () => { void reload(instance); },
        },
    };
}
function render(instance) {
    if (instance.disposed)
        return;
    renderTree(instance.root, treeContext(instance));
}
async function commitDraft(instance, rawTitle) {
    const title = rawTitle.trim();
    if (title.length === 0) {
        instance.view = { ...instance.view, draft: false, draftError: null };
        render(instance);
        return;
    }
    instance.view = { ...instance.view, draftBusy: true, draftError: null };
    render(instance);
    const result = await instance.store.createTask(title);
    if (instance.disposed)
        return;
    instance.view = result.ok
        ? { ...instance.view, draft: false, draftBusy: false, draftError: null }
        : { ...instance.view, draftBusy: false, draftError: result.message };
    render(instance);
}
async function commitRename(instance, taskId, rawTitle) {
    const title = rawTitle.trim();
    const current = instance.store.getState().tasks.find((task) => task.id === taskId);
    instance.view = { ...instance.view, editingTaskId: null };
    render(instance);
    if (title.length === 0 || !current || title === current.title)
        return;
    await instance.store.renameTask(taskId, title);
}
async function confirmDelete(instance, target) {
    instance.view = { ...instance.view, confirm: null };
    render(instance);
    if (target.kind === 'task') {
        await instance.store.deleteTask(target.taskId);
    }
    else if (target.projectId) {
        await instance.store.detachProject(target.taskId, target.projectId);
        instance.sessions.delete(target.projectId);
    }
}
async function attachProject(instance, taskId, project) {
    const result = await instance.store.attachProject(taskId, project.projectId, project.displayName);
    if (instance.disposed)
        return;
    if (!result.ok) {
        instance.view = { ...instance.view, pickerError: result.message };
        render(instance);
        return;
    }
    instance.view = { ...instance.view, pickerTaskId: null, pickerError: null };
    if (instance.caps.canNavigate) {
        // Deferred binding: the host opens a new chat, the attachment stays
        // `pending` until that session shows up in the project's session list (§9.6).
        instance.sessions.set(project.projectId, null);
        try {
            await instance.bridge.startNewSession(project.projectId);
        }
        catch {
            instance.view = { ...instance.view, pickerError: 'Could not start a new session.' };
        }
    }
    else {
        instance.view = { ...instance.view, pickerError: 'Open this project in Chat to start its session.' };
    }
    render(instance);
    void loadSessions(instance);
}
async function activateAttachment(instance, taskId, projectId) {
    if (!instance.caps.canNavigate)
        return;
    const task = instance.store.getState().tasks.find((candidate) => candidate.id === taskId);
    const attachment = task?.attachments.find((candidate) => candidate.projectId === projectId);
    if (!attachment)
        return;
    const session = instance.sessions.get(projectId) ?? null;
    const sessionId = session?.id ?? attachment.sessionId;
    try {
        if (sessionId)
            await instance.bridge.openSession(projectId, sessionId);
        else
            await instance.bridge.startNewSession(projectId);
    }
    catch (error) {
        reportHostError(instance, error);
    }
}
function reportHostError(instance, error) {
    if (error instanceof HostAuthError) {
        instance.authExpired = true;
        instance.store.setBanner(error.message);
    }
}
async function loadProjects(instance) {
    if (!instance.caps.canFetchHost || instance.authExpired)
        return;
    try {
        const projects = await instance.bridge.listProjects();
        if (instance.disposed)
            return;
        instance.projects = projects;
        instance.projectsLoaded = true;
        render(instance);
    }
    catch (error) {
        reportHostError(instance, error);
    }
}
/**
 * Resolves each attachment's session without any help from the host (D-2).
 *
 * A bound `sessionId` wins. Otherwise the project's newest session counts only
 * if it was created **after** the attachment: a project that already had chats
 * would otherwise adopt an old one the moment it is attached, and clicking the
 * node would reopen that old conversation instead of the new chat the user just
 * started. Once a genuinely new session appears it is written back through E8,
 * so the binding survives later sessions.
 */
async function loadSessions(instance) {
    if (!instance.caps.canFetchHost || instance.authExpired)
        return;
    const attachments = instance.store.getState().tasks.flatMap((task) => task.attachments.map((attachment) => ({ taskId: task.id, attachment })));
    const projectIds = new Set(attachments.map(({ attachment }) => attachment.projectId));
    let changed = false;
    for (const { taskId, attachment } of attachments) {
        const projectId = attachment.projectId;
        try {
            const sessions = await instance.bridge.listSessions(projectId, 1);
            if (instance.disposed)
                return;
            const newest = sessions[0] ?? null;
            const bound = attachment.sessionId
                ? sessions.find((session) => session.id === attachment.sessionId) ?? {
                    id: attachment.sessionId,
                    title: newest?.id === attachment.sessionId ? newest.title : 'Session',
                    createdAt: null,
                }
                : null;
            const startedAfterAttach = Boolean(newest?.createdAt && newest.createdAt > attachment.attachedAt);
            const resolved = bound ?? (startedAfterAttach ? newest : null);
            instance.sessions.set(projectId, resolved);
            changed = true;
            // First sighting of the session this attachment created: pin it (E8).
            if (!attachment.sessionId && resolved) {
                await instance.store.bindSession(taskId, projectId, resolved.id);
            }
        }
        catch (error) {
            reportHostError(instance, error);
            if (instance.authExpired)
                return;
        }
    }
    // Drop cache entries for projects that are no longer attached anywhere.
    for (const projectId of [...instance.sessions.keys()]) {
        if (!projectIds.has(projectId)) {
            instance.sessions.delete(projectId);
            changed = true;
        }
    }
    if (changed)
        render(instance);
}
async function reload(instance) {
    instance.authExpired = false;
    instance.bridge.invalidate();
    instance.store.setBanner(null);
    await instance.store.loadTasks();
    await loadProjects(instance);
    await loadSessions(instance);
}
export function mount(container, api) {
    unmount(container);
    injectStyles();
    const caps = detect(api);
    const root = document.createElement('div');
    root.className = `tw-root tw-surface-${caps.surface}`;
    const store = new TaskStore(api);
    const instance = {
        root,
        api,
        caps,
        bridge: createBridge(api, caps),
        store,
        view: initialView(),
        projects: [],
        projectsLoaded: false,
        sessions: new Map(),
        authExpired: false,
        disposed: false,
        timer: setInterval(() => updateAges(root, new Date()), AGE_TICK_MS),
        unsubscribeContext: () => undefined,
        unsubscribeStore: () => undefined,
        onDocumentPointerDown: () => undefined,
        onKeydown: () => undefined,
    };
    instance.unsubscribeStore = store.subscribe(() => {
        render(instance);
        void loadSessions(instance);
    });
    instance.unsubscribeContext = api.onContextChange((context) => {
        applyTheme(instance, context);
        instance.bridge.invalidate();
        // In stock mode this is what re-labels the `Attach “<project>”` button.
        render(instance);
        void loadProjects(instance);
        void loadSessions(instance);
    });
    // One document-level listener per instance closes an open drop-down on an
    // outside click; it is removed again in unmount (§10).
    instance.onDocumentPointerDown = (event) => {
        if (instance.view.pickerTaskId === null)
            return;
        const target = event.target;
        if (target && root.contains(target) && target.closest?.('.tw-picker'))
            return;
        instance.view = { ...instance.view, pickerTaskId: null };
        render(instance);
    };
    document.addEventListener('pointerdown', instance.onDocumentPointerDown, true);
    instance.onKeydown = (event) => handleTreeKeydown(event, root, treeContext(instance));
    root.addEventListener('keydown', instance.onKeydown);
    applyTheme(instance, api.context);
    container.replaceChildren(root);
    instances.set(container, instance);
    render(instance);
    void store.loadTasks();
    void loadProjects(instance);
}
export function unmount(container) {
    const instance = instances.get(container);
    if (!instance)
        return;
    instance.disposed = true;
    instance.unsubscribeContext();
    instance.unsubscribeStore();
    clearInterval(instance.timer);
    document.removeEventListener('pointerdown', instance.onDocumentPointerDown, true);
    instance.root.removeEventListener('keydown', instance.onKeydown);
    instance.store.dispose();
    instances.delete(container);
    container.replaceChildren();
}
