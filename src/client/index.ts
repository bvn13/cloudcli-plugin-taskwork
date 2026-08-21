import type { Attachment, Task } from '../shared/types.js';
import type { Capabilities, PluginApi, PluginContext } from './capabilities.js';
import { detect } from './capabilities.js';
import { basename, createBridge, HostAuthError } from './host-bridge.js';
import type { HostBridge, HostProject, HostSession } from './host-bridge.js';
import { TaskStore } from './store.js';
import { injectStyles } from './styles.js';
import { handleTreeKeydown, renderTree, updateAges } from './views/TaskTree.js';
import type { AttachmentView, ConfirmTarget, TreeContext, ViewState } from './views/TaskTree.js';

const AGE_TICK_MS = 60_000;

/** Session lookup per project: `undefined` = not fetched, `null` = no session yet. */
type SessionEntry = HostSession | null;

interface Instance {
  root: HTMLElement;
  api: PluginApi;
  caps: Capabilities;
  bridge: HostBridge;
  store: TaskStore;
  view: ViewState;
  projects: HostProject[];
  projectsLoaded: boolean;
  sessions: Map<string, SessionEntry>;
  /** Set once the host refuses our requests: retrying would only hammer it (§11). */
  authExpired: boolean;
  disposed: boolean;
  timer: ReturnType<typeof setInterval>;
  unsubscribeContext: () => void;
  unsubscribeStore: () => void;
  onDocumentPointerDown: (event: Event) => void;
  onKeydown: (event: KeyboardEvent) => void;
}

// Per-container state: the same module may be mounted into the tab and the
// sidebar at the same time, so nothing mutable may live at module level (§6.5).
const instances = new WeakMap<HTMLElement, Instance>();

function initialView(): ViewState {
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

function applyTheme(instance: Instance, context: PluginContext): void {
  const dark = context.theme !== 'light';
  instance.root.classList.toggle('tw-theme-dark', dark);
  instance.root.classList.toggle('tw-theme-light', !dark);
}

function currentProjectName(instance: Instance): string {
  const project = instance.api.context.project;
  if (!project) return '';
  const known = instance.projects.find((candidate) => candidate.projectId === project.name);
  return known?.displayName ?? basename(project.path) ?? project.name;
}

function view(
  projectName: string,
  sessionLabel: string,
  rest: { clickable: boolean; pending: boolean; removed: boolean },
): AttachmentView {
  return { projectName, sessionLabel, label: `${projectName} — ${sessionLabel}`, ...rest };
}

function describeAttachment(instance: Instance, _task: Task, attachment: Attachment): AttachmentView {
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
function treeContext(instance: Instance): TreeContext {
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
        if (!instance.view.draft) return;
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
        if (instance.view.pickerTaskId === null) return;
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

function render(instance: Instance): void {
  if (instance.disposed) return;
  renderTree(instance.root, treeContext(instance));
}

async function commitDraft(instance: Instance, rawTitle: string): Promise<void> {
  const title = rawTitle.trim();
  if (title.length === 0) {
    instance.view = { ...instance.view, draft: false, draftError: null };
    render(instance);
    return;
  }

  instance.view = { ...instance.view, draftBusy: true, draftError: null };
  render(instance);

  const result = await instance.store.createTask(title);
  if (instance.disposed) return;

  instance.view = result.ok
    ? { ...instance.view, draft: false, draftBusy: false, draftError: null }
    : { ...instance.view, draftBusy: false, draftError: result.message };
  render(instance);
}

async function commitRename(instance: Instance, taskId: string, rawTitle: string): Promise<void> {
  const title = rawTitle.trim();
  const current = instance.store.getState().tasks.find((task) => task.id === taskId);

  instance.view = { ...instance.view, editingTaskId: null };
  render(instance);

  if (title.length === 0 || !current || title === current.title) return;
  await instance.store.renameTask(taskId, title);
}

async function confirmDelete(instance: Instance, target: ConfirmTarget): Promise<void> {
  instance.view = { ...instance.view, confirm: null };
  render(instance);

  if (target.kind === 'task') {
    await instance.store.deleteTask(target.taskId);
  } else if (target.projectId) {
    await instance.store.detachProject(target.taskId, target.projectId);
    instance.sessions.delete(target.projectId);
  }
}

async function attachProject(instance: Instance, taskId: string, project: HostProject): Promise<void> {
  const result = await instance.store.attachProject(taskId, project.projectId, project.displayName);
  if (instance.disposed) return;

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
    } catch {
      instance.view = { ...instance.view, pickerError: 'Could not start a new session.' };
    }
  } else {
    instance.view = { ...instance.view, pickerError: 'Open this project in Chat to start its session.' };
  }

  render(instance);
  void loadSessions(instance);
}

async function activateAttachment(instance: Instance, taskId: string, projectId: string): Promise<void> {
  if (!instance.caps.canNavigate) return;

  const task = instance.store.getState().tasks.find((candidate) => candidate.id === taskId);
  const attachment = task?.attachments.find((candidate) => candidate.projectId === projectId);
  if (!attachment) return;

  const session = instance.sessions.get(projectId) ?? null;
  const sessionId = session?.id ?? attachment.sessionId;

  try {
    if (sessionId) await instance.bridge.openSession(projectId, sessionId);
    else await instance.bridge.startNewSession(projectId);
  } catch (error) {
    reportHostError(instance, error);
  }
}

function reportHostError(instance: Instance, error: unknown): void {
  if (error instanceof HostAuthError) {
    instance.authExpired = true;
    instance.store.setBanner(error.message);
  }
}

async function loadProjects(instance: Instance): Promise<void> {
  if (!instance.caps.canFetchHost || instance.authExpired) return;

  try {
    const projects = await instance.bridge.listProjects();
    if (instance.disposed) return;
    instance.projects = projects;
    instance.projectsLoaded = true;
    render(instance);
  } catch (error) {
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
async function loadSessions(instance: Instance): Promise<void> {
  if (!instance.caps.canFetchHost || instance.authExpired) return;

  const attachments = instance.store.getState().tasks.flatMap(
    (task) => task.attachments.map((attachment) => ({ taskId: task.id, attachment })),
  );
  const projectIds = new Set(attachments.map(({ attachment }) => attachment.projectId));

  let changed = false;
  for (const { taskId, attachment } of attachments) {
    const projectId = attachment.projectId;
    try {
      const sessions = await instance.bridge.listSessions(projectId, 1);
      if (instance.disposed) return;

      const newest = sessions[0] ?? null;
      const bound = attachment.sessionId
        ? sessions.find((session) => session.id === attachment.sessionId) ?? {
          id: attachment.sessionId,
          title: newest?.id === attachment.sessionId ? newest.title : 'Session',
          createdAt: null,
        }
        : null;

      const startedAfterAttach = Boolean(
        newest?.createdAt && newest.createdAt > attachment.attachedAt,
      );
      const resolved = bound ?? (startedAfterAttach ? newest : null);

      instance.sessions.set(projectId, resolved);
      changed = true;

      // First sighting of the session this attachment created: pin it (E8).
      if (!attachment.sessionId && resolved) {
        await instance.store.bindSession(taskId, projectId, resolved.id);
      }
    } catch (error) {
      reportHostError(instance, error);
      if (instance.authExpired) return;
    }
  }

  // Drop cache entries for projects that are no longer attached anywhere.
  for (const projectId of [...instance.sessions.keys()]) {
    if (!projectIds.has(projectId)) {
      instance.sessions.delete(projectId);
      changed = true;
    }
  }

  if (changed) render(instance);
}

async function reload(instance: Instance): Promise<void> {
  instance.authExpired = false;
  instance.bridge.invalidate();
  instance.store.setBanner(null);
  await instance.store.loadTasks();
  await loadProjects(instance);
  await loadSessions(instance);
}

export function mount(container: HTMLElement, api: PluginApi): void {
  unmount(container);
  injectStyles();

  const caps = detect(api);
  const root = document.createElement('div');
  root.className = `tw-root tw-surface-${caps.surface}`;

  const store = new TaskStore(api);
  const instance: Instance = {
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
  instance.onDocumentPointerDown = (event: Event) => {
    if (instance.view.pickerTaskId === null) return;
    const target = event.target as Node | null;
    if (target && root.contains(target) && (target as HTMLElement).closest?.('.tw-picker')) return;
    instance.view = { ...instance.view, pickerTaskId: null };
    render(instance);
  };
  document.addEventListener('pointerdown', instance.onDocumentPointerDown, true);

  instance.onKeydown = (event: KeyboardEvent) => handleTreeKeydown(event, root, treeContext(instance));
  root.addEventListener('keydown', instance.onKeydown);

  applyTheme(instance, api.context);
  container.replaceChildren(root);
  instances.set(container, instance);

  render(instance);
  void store.loadTasks();
  void loadProjects(instance);
}

export function unmount(container: HTMLElement): void {
  const instance = instances.get(container);
  if (!instance) return;

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
