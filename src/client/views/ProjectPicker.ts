import type { Task } from '../../shared/types.js';
import type { HostProject } from '../host-bridge.js';
import { el } from '../dom.js';
import type { TreeContext } from './TaskTree.js';

/** Projects are offered by their display name, never by path (§9.6, step 4). */
export function sortProjectsByDisplayName(projects: HostProject[]): HostProject[] {
  return [...projects].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, 'en', { sensitivity: 'base' }));
}

/** A project belongs to at most one task, so taken ones are not even offered (INV-3). */
export function availableProjects(projects: HostProject[], lockedProjectIds: string[]): HostProject[] {
  const locked = new Set(lockedProjectIds);
  return sortProjectsByDisplayName(projects.filter((project) => !locked.has(project.projectId)));
}

function pickerError(message: string | null): HTMLElement | null {
  return message ? el('div', { className: 'tw-error', text: message }) : null;
}

/**
 * Stock mode has no way to enumerate the host's projects, so the picker
 * collapses into a single action on the currently selected one (§6.3).
 */
function createAttachCurrentButton(context: TreeContext, task: Task): HTMLElement {
  const project = context.currentProject;
  const projectId = project?.name ?? null;
  const locked = projectId !== null && context.state.lockedProjectIds.includes(projectId);
  const displayName = context.currentProjectName;

  const button = el('button', {
    className: 'tw-button tw-button-wide tw-button-quiet',
    text: project ? `+ Attach “${displayName}”` : '+ Attach current project',
    attrs: { type: 'button', 'data-role': 'attach-current' },
  });

  const hint = !project
    ? 'Select a project first'
    : locked
      ? 'This project is already used by another task'
      : null;

  button.disabled = hint !== null;
  if (hint) button.title = hint;

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

function createListbox(context: TreeContext, task: Task): HTMLElement {
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
      text: project.displayName,
      title: project.fullPath || project.displayName,
      attrs: { type: 'button', role: 'option', 'aria-selected': 'false' },
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
    const next = event.relatedTarget as Node | null;
    if (next && listbox.contains(next)) return;
    context.callbacks.closePicker();
  });

  const first = listbox.querySelector('button');
  if (first instanceof HTMLElement) requestAnimationFrame(() => first.focus());

  return el('div', { className: 'tw-picker', children: [listbox, pickerError(context.view.pickerError)] });
}

/**
 * Renders the "attach a project" affordance for one task: a button that turns
 * into a drop-down in full mode, a single button in stock mode.
 */
export function createProjectPicker(context: TreeContext, task: Task): HTMLElement {
  if (!context.caps.canFetchHost) return createAttachCurrentButton(context, task);

  if (context.view.pickerTaskId !== task.id) {
    const button = el('button', {
      className: 'tw-button tw-button-wide tw-button-quiet',
      text: '+ Add project',
      attrs: { type: 'button', 'data-role': 'add-project' },
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
