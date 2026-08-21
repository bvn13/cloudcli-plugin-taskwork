import type { Task } from '../../shared/types.js';
import { formatCompactAge } from '../../shared/age.js';
import { el, focusSoon, iconButton } from '../dom.js';
import type { TreeContext } from './TaskTree.js';

export const AGE_ATTR = 'data-created-at';

/**
 * Inline editor shared by the draft node and by rename (§9.3, §9.4).
 *
 * `Enter` commits and `Escape` cancels; the difference between the two is what
 * `blur` means — a draft is dropped, a rename is saved. Committing moves focus,
 * which fires `blur`, so a guard flag keeps that from running the other branch.
 */
function createInlineInput(options: {
  value: string;
  placeholder: string;
  busy: boolean;
  onCommit: (value: string) => void;
  onCancel: () => void;
  onBlur: (value: string) => void;
}): HTMLInputElement {
  const input = el('input', {
    className: 'tw-node-input',
    attrs: { type: 'text', placeholder: options.placeholder, 'aria-label': options.placeholder },
  });
  input.value = options.value;
  input.disabled = options.busy;

  let settled = false;
  const settle = (action: () => void) => {
    if (settled) return;
    settled = true;
    action();
  };

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      settle(() => options.onCommit(input.value));
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      settle(options.onCancel);
    }
  });

  input.addEventListener('blur', () => settle(() => options.onBlur(input.value)));

  if (!options.busy) focusSoon(input);
  return input;
}

/** The unsaved task row: it lives directly under the `+` button until Enter or blur. */
export function createDraftNode(context: TreeContext): HTMLElement {
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
    children: [el('span', { className: 'tw-chevron' }), input],
  });

  return el('div', {
    children: [
      row,
      context.view.draftError ? el('div', { className: 'tw-error', text: context.view.draftError }) : null,
    ],
  });
}

export function createTaskNode(context: TreeContext, task: Task, now: Date): HTMLElement {
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

  const chevron = el('span', { className: 'tw-chevron', text: expanded ? '▾' : '▸', attrs: { 'aria-hidden': 'true' } });
  row.appendChild(chevron);

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
  } else {
    const label = el('span', { className: 'tw-node-label', text: task.title, title: task.title });
    label.addEventListener('dblclick', (event) => {
      event.stopPropagation();
      context.callbacks.startRename(task.id);
    });
    row.appendChild(label);

    const age = el('span', { className: 'tw-age', text: formatCompactAge(task.createdAt, now) });
    age.setAttribute(AGE_ATTR, task.createdAt);
    row.appendChild(age);

    const remove = iconButton('tw-icon', `Delete task ${task.title}`, '×');
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      context.callbacks.requestDelete({ kind: 'task', taskId: task.id });
    });
    row.appendChild(remove);

    row.addEventListener('click', () => context.callbacks.toggle(task.id));
  }

  return row;
}
