import type { Attachment, Task } from '../../shared/types.js';
import { el, iconButton } from '../dom.js';
import type { TreeContext } from './TaskTree.js';

/**
 * A child node of a task: one attached project, labelled with its latest
 * session. What the label says and whether the row is clickable depends on the
 * host's capabilities, never on a guess (§9.5.1).
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
      el('span', { className: 'tw-node-label', text: view.label, title: view.label }),
      view.clickable ? el('span', { className: 'tw-chip', text: '›', attrs: { 'aria-hidden': 'true' } }) : null,
    ],
  });

  const detach = iconButton('tw-icon', `Detach ${attachment.projectName}`, '×');
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
