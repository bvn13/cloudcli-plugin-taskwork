import { ICON_PLUS, el, icon } from '../dom.js';

/**
 * Sits where the host's search box would be (§9.2) and starts a draft task.
 * Styled like the host's own primary action button so the section opens with a
 * familiar affordance. Pressing it again while a draft is open replaces that
 * draft (§9.3, step 6).
 */
export function createAddTaskButton(onStartDraft: () => void): HTMLElement {
  const button = el('button', {
    className: 'tw-button tw-button-wide',
    attrs: { type: 'button', 'aria-label': 'Add new task' },
    children: [icon(ICON_PLUS), el('span', { text: 'Add new task' })],
  });

  button.addEventListener('click', () => onStartDraft());
  return el('div', { className: 'tw-toolbar', children: [button] });
}
