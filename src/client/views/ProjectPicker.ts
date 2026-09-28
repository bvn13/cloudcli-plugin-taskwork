import type { Task } from '../../shared/types.js';
import type { HostProject } from '../host-bridge.js';
import { ICON_FOLDER, ICON_PLUS, el, icon } from '../dom.js';
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

/** Case-insensitive substring match on the display name — the only name the user sees. */
export function matchesQuery(project: HostProject, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  return needle.length === 0 || project.displayName.toLocaleLowerCase().includes(needle);
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
  const projects = availableProjects(context.projects, context.state.lockedProjectIds);
  const listbox = el('div', {
    className: 'tw-listbox',
    attrs: { id: `tw-listbox-${task.id}`, role: 'listbox', 'aria-label': 'Attach a project', tabindex: '-1' },
  });

  const search = el('input', {
    className: 'tw-picker-search',
    attrs: {
      type: 'text',
      placeholder: 'Filter projects',
      'aria-label': 'Filter projects',
      'aria-controls': listbox.id,
      autocomplete: 'off',
      spellcheck: 'false',
      'data-picker-search': '',
    },
  });
  search.value = context.view.pickerQuery;

  const options = projects.map((project) => {
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
    return { project, option };
  });

  const empty = el('div', {
    className: 'tw-option',
    attrs: { role: 'option', 'aria-disabled': 'true' },
  });
  listbox.appendChild(empty);

  // Filtering hides rows in place rather than re-rendering, so typing never
  // loses the caret; the query itself lives in the view state for re-renders.
  const applyFilter = () => {
    let shown = 0;
    for (const { project, option } of options) {
      const visible = matchesQuery(project, search.value);
      option.hidden = !visible;
      if (visible) shown += 1;
    }
    empty.textContent = projects.length === 0 ? 'No available projects' : 'No matching projects';
    empty.hidden = shown > 0;
  };
  applyFilter();

  const visibleOptions = () => options.filter(({ option }) => !option.hidden).map(({ option }) => option);

  search.addEventListener('input', () => {
    context.callbacks.setPickerQuery(search.value);
    applyFilter();
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      visibleOptions()[0]?.focus();
    } else if (event.key === 'Enter') {
      // Enter takes the first match, so "type a few letters, Enter" is enough.
      event.preventDefault();
      visibleOptions()[0]?.click();
    }
  });

  listbox.addEventListener('keydown', (event) => {
    const visible = visibleOptions();
    const index = visible.indexOf(event.target as HTMLButtonElement);
    if (index === -1) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      visible[Math.min(index + 1, visible.length - 1)]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      (index === 0 ? search : visible[index - 1])?.focus();
    }
  });

  const dropdown = el('div', { className: 'tw-dropdown', children: [search, listbox] });

  dropdown.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      context.callbacks.closePicker();
    }
  });

  // Leaving the drop-down by keyboard closes it too; a click outside is handled
  // by the single document-level listener owned by the instance (§10).
  dropdown.addEventListener('focusout', (event) => {
    // A re-render detaches the old drop-down while it still holds focus; that
    // focusout belongs to the old tree and must close nothing.
    if (!dropdown.isConnected) return;
    const next = event.relatedTarget as Node | null;
    if (next && dropdown.contains(next)) return;
    context.callbacks.closePicker();
  });

  // A re-render (the store or the session list changed) rebuilds the picker; it
  // takes focus only when it is new or already had it, never from elsewhere.
  const active = document.activeElement as HTMLElement | null;
  const autoFocus = !active || active === document.body || Boolean(active.closest?.('.tw-picker'));
  if (autoFocus) {
    requestAnimationFrame(() => {
      search.focus();
      // Not `select()`: a re-render mid-typing would have the next key wipe the query.
      search.setSelectionRange?.(search.value.length, search.value.length);
    });
  }

  return el('div', { className: 'tw-picker', children: [dropdown, pickerError(context.view.pickerError)] });
}

/**
 * Renders the "attach a project" affordance for one task: a button that turns
 * into a drop-down in full mode, a single button in stock mode.
 */
export function createProjectPicker(context: TreeContext, task: Task): HTMLElement {
  if (!context.caps.canFetchHost) return createAttachCurrentButton(context, task);

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
