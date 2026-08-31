import type { Attachment, Task } from '../../shared/types.js';
import { formatCompactAge } from '../../shared/age.js';
import type { Capabilities, PluginProject } from '../capabilities.js';
import type { HostProject } from '../host-bridge.js';
import type { TaskState, TaskStore } from '../store.js';
import { el } from '../dom.js';
import { createAddTaskButton } from './AddTaskButton.js';
import { createAttachmentNode } from './AttachmentNode.js';
import { AGE_ATTR, createDraftNode, createTaskNode } from './TaskNode.js';
import { createProjectPicker } from './ProjectPicker.js';

export interface ConfirmTarget {
  kind: 'task' | 'attachment';
  taskId: string;
  projectId?: string;
}

export interface ViewState {
  draft: boolean;
  draftBusy: boolean;
  draftError: string | null;
  /** What has been typed into the draft so far — it survives re-renders (§9.3). */
  draftTitle: string;
  editingTaskId: string | null;
  confirm: ConfirmTarget | null;
  pickerTaskId: string | null;
  pickerError: string | null;
  /** Roving tabindex: exactly one node in the tree is tabbable (§9.8). */
  activeNodeId: string | null;
}

export interface AttachmentView {
  /** Title line: the project, named as the host names it today. */
  projectName: string;
  /** Subtitle line: the session this attachment points at, or its absence. */
  sessionLabel: string;
  /** Both lines joined — used for the accessible name. */
  label: string;
  clickable: boolean;
  pending: boolean;
  removed: boolean;
}

export interface TreeCallbacks {
  startDraft(): void;
  cancelDraft(): void;
  setDraftTitle(title: string): void;
  commitDraft(title: string): void;
  toggle(taskId: string): void;
  startRename(taskId: string): void;
  commitRename(taskId: string, title: string): void;
  cancelRename(): void;
  requestDelete(target: ConfirmTarget): void;
  confirmDelete(target: ConfirmTarget): void;
  cancelDelete(): void;
  openPicker(taskId: string): void;
  closePicker(): void;
  attach(taskId: string, project: HostProject): void;
  activateAttachment(taskId: string, projectId: string): void;
  setActiveNode(nodeId: string): void;
  retry(): void;
}

export interface TreeContext {
  state: TaskState;
  view: ViewState;
  caps: Capabilities;
  store: TaskStore;
  /** Host projects for the drop-down; empty in stock mode. */
  projects: HostProject[];
  currentProject: PluginProject | null;
  currentProjectName: string;
  describeAttachment(task: Task, attachment: Attachment): AttachmentView;
  callbacks: TreeCallbacks;
}

const STOCK_MODE_BANNER = 'Limited mode — update CloudCLI to enable the project picker.';

function createBanner(text: string, isError: boolean, onRetry?: () => void): HTMLElement {
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
function createConfirmRow(context: TreeContext, target: ConfirmTarget, text: string): HTMLElement {
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

function sameTarget(a: ConfirmTarget | null, b: ConfirmTarget): boolean {
  return a !== null && a.kind === b.kind && a.taskId === b.taskId && a.projectId === b.projectId;
}

function createTaskGroup(context: TreeContext, task: Task): HTMLElement {
  const group = el('div', { className: 'tw-group', attrs: { role: 'group' } });

  for (const attachment of task.attachments) {
    group.appendChild(createAttachmentNode(context, task, attachment));

    const target: ConfirmTarget = { kind: 'attachment', taskId: task.id, projectId: attachment.projectId };
    if (sameTarget(context.view.confirm, target)) {
      group.appendChild(createConfirmRow(context, target, `Detach “${attachment.projectName}”?`));
    }
  }

  // Attaching is only offered on a saved task — a draft has no id to attach to.
  group.appendChild(createProjectPicker(context, task));
  return group;
}

export function renderTree(root: HTMLElement, context: TreeContext): void {
  const now = new Date();
  const children: (Node | null)[] = [];

  if (context.state.banner) {
    children.push(createBanner(context.state.banner, true, () => context.callbacks.retry()));
  } else if (!context.caps.canFetchHost) {
    children.push(createBanner(STOCK_MODE_BANNER, false));
  }

  children.push(createAddTaskButton(() => context.callbacks.startDraft()));

  const tree = el('div', {
    className: 'tw-tree',
    attrs: { role: 'tree', 'aria-label': 'Tasks' },
  });

  if (context.view.draft) {
    // A draft outlives a re-render now, so it may only grab focus when it is new,
    // when it already had it, or when the disabled `busy` input has just dropped
    // it — never pull focus away from wherever the user moved it.
    const previous = root.querySelector('[data-draft-input]') as HTMLInputElement | null;
    const autoFocus = previous === null || previous.disabled || document.activeElement === previous;
    tree.appendChild(createDraftNode(context, autoFocus));
  }

  if (context.state.status === 'loading' && context.state.tasks.length === 0) {
    tree.appendChild(el('div', { className: 'tw-hint', text: 'Loading tasks…' }));
  } else if (context.state.status === 'error' && context.state.tasks.length === 0) {
    tree.appendChild(el('div', { className: 'tw-error', text: 'Failed to load tasks.' }));
  } else if (context.state.tasks.length === 0 && !context.view.draft) {
    tree.appendChild(el('div', { className: 'tw-empty', text: 'No tasks yet. Click + to create one.' }));
  }

  for (const task of context.state.tasks) {
    tree.appendChild(createTaskNode(context, task, now));

    const target: ConfirmTarget = { kind: 'task', taskId: task.id };
    if (sameTarget(context.view.confirm, target)) {
      tree.appendChild(createConfirmRow(context, target, `Delete “${task.title}” and detach its projects?`));
    }

    if (context.store.isExpanded(task.id)) tree.appendChild(createTaskGroup(context, task));
  }

  children.push(tree);
  root.replaceChildren(...children.filter((node): node is Node => node !== null));

  ensureActiveNode(root, context);
}

/** Keeps exactly one treeitem tabbable, falling back to the first one. */
function ensureActiveNode(root: HTMLElement, context: TreeContext): void {
  const nodes = visibleNodes(root);
  if (nodes.length === 0) return;

  const active = nodes.find((node) => node.dataset.nodeId === context.view.activeNodeId) ?? nodes[0];
  if (!active) return;
  for (const node of nodes) node.tabIndex = node === active ? 0 : -1;
}

function visibleNodes(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[role="treeitem"]')];
}

/** Refreshes every age badge in place — no re-render, no lost focus (§9.4). */
export function updateAges(root: HTMLElement, now: Date): void {
  for (const badge of root.querySelectorAll<HTMLElement>(`[${AGE_ATTR}]`)) {
    badge.textContent = formatCompactAge(badge.getAttribute(AGE_ATTR), now);
  }
}

/**
 * Tree keyboard model (§9.8): ↑/↓ walk visible nodes, →/← expand and collapse,
 * Enter activates, F2 renames, Delete asks for confirmation.
 */
export function handleTreeKeydown(event: KeyboardEvent, root: HTMLElement, context: TreeContext): void {
  const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[role="treeitem"]');
  if (!target) return;

  const nodes = visibleNodes(root);
  const index = nodes.indexOf(target);
  const nodeId = target.dataset.nodeId ?? '';
  const taskId = target.dataset.taskId ?? '';
  const projectId = target.dataset.projectId;
  const isTask = nodeId.startsWith('task:');

  const focusAt = (next: number) => {
    const node = nodes[Math.max(0, Math.min(nodes.length - 1, next))];
    if (!node) return;
    event.preventDefault();
    for (const other of nodes) other.tabIndex = other === node ? 0 : -1;
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
      } else {
        focusAt(index + 1);
      }
      break;
    case 'ArrowLeft':
      if (isTask && context.store.isExpanded(taskId)) {
        event.preventDefault();
        context.callbacks.toggle(taskId);
      } else if (!isTask) {
        focusAt(nodes.findIndex((node) => node.dataset.nodeId === `task:${taskId}`));
      }
      break;
    case 'Enter':
      event.preventDefault();
      if (isTask) context.callbacks.toggle(taskId);
      else if (projectId) context.callbacks.activateAttachment(taskId, projectId);
      break;
    case 'F2':
      if (isTask) {
        event.preventDefault();
        context.callbacks.startRename(taskId);
      }
      break;
    case 'Delete':
      event.preventDefault();
      context.callbacks.requestDelete(
        isTask ? { kind: 'task', taskId } : { kind: 'attachment', taskId, projectId },
      );
      break;
    default:
      break;
  }
}
