import type { Task } from '../../shared/types.js';
import { formatCompactAge } from '../../shared/age.js';
import {
  ICON_CHEVRON_DOWN,
  ICON_CHEVRON_RIGHT,
  ICON_LIST,
  ICON_PENCIL,
  ICON_TRASH,
  el,
  focusSoon,
  icon,
} from '../dom.js';
import type { TreeContext } from './TaskTree.js';

export const AGE_ATTR = 'data-created-at';

/**
 * Inline editor shared by the draft node and by rename (§9.3, §9.4).
 *
 * `Enter` commits and `Escape` cancels; the difference between the two is what
 * `blur` means — a rename is saved, a draft simply stays put (no `onBlur`).
 * Committing moves focus, which fires `blur`, so a guard flag keeps that from
 * running the other branch.
 */
function createInlineInput(options: {
  value: string;
  placeholder: string;
  busy: boolean;
  onCommit: (value: string) => void;
  onCancel: () => void;
  onBlur?: (value: string) => void;
  onInput?: (value: string) => void;
  attrs?: Record<string, string>;
  autoFocus?: boolean;
}): HTMLInputElement {
  const input = el('input', {
    className: 'tw-node-input',
    attrs: {
      type: 'text',
      placeholder: options.placeholder,
      'aria-label': options.placeholder,
      ...options.attrs,
    },
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

  const onBlur = options.onBlur;
  if (onBlur) input.addEventListener('blur', () => settle(() => onBlur(input.value)));

  const onInput = options.onInput;
  if (onInput) input.addEventListener('input', () => onInput(input.value));

  if (!options.busy && options.autoFocus !== false) focusSoon(input);
  return input;
}

/**
 * The task row's actions (§9.4), in a drop-down anchored to the age badge.
 *
 * They used to be two hover buttons sitting in the row, which cost 48px of row
 * width whether or not they were visible — width a narrow sidebar spends on the
 * title instead. The menu is positioned absolutely, so it overlays the tree when
 * it opens rather than reserving anything while it is closed.
 */
function createRowMenu(context: TreeContext, task: Task): HTMLElement {
  const menu = el('div', {
    className: 'tw-menu',
    attrs: { role: 'menu', 'aria-label': `Actions for “${task.title}”`, tabindex: '-1' },
  });

  const item = (className: string, label: string, glyph: Node, action: () => void): HTMLElement => {
    const button = el('button', {
      className,
      attrs: { type: 'button', role: 'menuitem' },
      children: [glyph, el('span', { text: label })],
    });
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      action();
    });
    menu.appendChild(button);
    return button;
  };

  const rename = item('tw-option', 'Rename', icon(ICON_PENCIL), () => context.callbacks.startRename(task.id));
  item('tw-option tw-option-danger', 'Delete', icon(ICON_TRASH), () =>
    context.callbacks.requestDelete({ kind: 'task', taskId: task.id }));

  menu.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    context.callbacks.closeMenu(true);
  });

  // Leaving by keyboard closes the menu; a click outside is handled by the single
  // document-level listener owned by the instance (§10), as it is for the picker.
  menu.addEventListener('focusout', (event) => {
    // A re-render detaches this menu while its item still holds focus; the
    // focusout that follows belongs to the old tree and must close nothing.
    if (!menu.isConnected) return;
    const next = event.relatedTarget as Node | null;
    if (next && menu.contains(next)) return;
    context.callbacks.closeMenu();
  });

  requestAnimationFrame(() => rename.focus());
  return menu;
}

/** Subtitle under a task title, mirroring the project row's session count. */
function attachmentSummary(task: Task): string {
  const count = task.attachments.length;
  if (count === 0) return 'No projects';
  return count === 1 ? '1 project' : `${count} projects`;
}

/** The unsaved task row: it lives directly under the `+` button until Enter or Escape. */
export function createDraftNode(context: TreeContext, autoFocus: boolean): HTMLElement {
  const input = createInlineInput({
    value: context.view.draftTitle,
    placeholder: 'Task name',
    busy: context.view.draftBusy,
    onCommit: (value) => context.callbacks.commitDraft(value),
    onCancel: () => context.callbacks.cancelDraft(),
    // No `onBlur`: clicking away keeps the draft and whatever was typed in it.
    onInput: (value) => context.callbacks.setDraftTitle(value),
    attrs: { 'data-draft-input': '' },
    autoFocus,
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
  } else {
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

    // The age badge doubles as the actions trigger: rename and delete live in the
    // drop-down it opens, so the row spends no width on them while it is closed.
    const menuOpen = context.view.menuTaskId === task.id;
    const value = el('span', { text: formatCompactAge(task.createdAt, now) });
    value.setAttribute(AGE_ATTR, task.createdAt);

    const age = el('button', {
      className: 'tw-age',
      title: 'Task actions',
      attrs: {
        type: 'button',
        'aria-haspopup': 'menu',
        'aria-expanded': String(menuOpen),
        'aria-label': `Task actions — ${task.title}`,
      },
      children: [value],
    });
    age.addEventListener('click', (event) => {
      event.stopPropagation();
      if (menuOpen) context.callbacks.closeMenu(true);
      else context.callbacks.openMenu(task.id);
    });
    row.appendChild(age);

    row.appendChild(el('span', {
      className: 'tw-chevron',
      attrs: { 'aria-hidden': 'true' },
      children: [icon(expanded ? ICON_CHEVRON_DOWN : ICON_CHEVRON_RIGHT)],
    }));

    if (menuOpen) row.appendChild(createRowMenu(context, task));

    row.addEventListener('click', () => context.callbacks.toggle(task.id));
  }

  return row;
}
