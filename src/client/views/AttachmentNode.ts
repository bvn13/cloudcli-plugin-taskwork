import type { Attachment, Task } from '../../shared/types.js';
import { ICON_MESSAGE, ICON_TRASH, el, icon, iconButton } from '../dom.js';
import type { TreeContext } from './TaskTree.js';

/**
 * A child node of a task: one attached project, with its session underneath —
 * laid out like the host's own session rows. What the subtitle says and whether
 * the row is clickable depends on the host's capabilities, never on a guess
 * (§9.5.1).
 */
export function createAttachmentNode(
  context: TreeContext,
  task: Task,
  attachment: Attachment,
): HTMLElement {
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
