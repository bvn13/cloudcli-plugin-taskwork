/**
 * Minimal DOM helpers. User-provided strings are always assigned through
 * `textContent`; `innerHTML` is never used anywhere in the client (§11, §14).
 */

export interface ElementOptions {
  className?: string;
  text?: string;
  title?: string;
  attrs?: Record<string, string>;
  children?: (Node | null)[];
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.title !== undefined) node.title = options.title;
  for (const [name, value] of Object.entries(options.attrs ?? {})) node.setAttribute(name, value);
  for (const child of options.children ?? []) if (child) node.appendChild(child);
  return node;
}

/** Icon-sized button with an accessible name (minimum hit area comes from CSS). */
export function iconButton(className: string, label: string, glyph: Node | string): HTMLButtonElement {
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
export function icon(paths: string[], className = 'tw-svg'): SVGElement {
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

export const ICON_CHEVRON_RIGHT = ['m9 18 6-6-6-6'];
export const ICON_CHEVRON_DOWN = ['m6 9 6 6 6-6'];
export const ICON_PLUS = ['M5 12h14', 'M12 5v14'];
export const ICON_TRASH = ['M3 6h18', 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'];
// The host's rename affordance is lucide `Edit3` (`pen-line`) — the same glyph here.
export const ICON_PENCIL = [
  'M12 20h9',
  'M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z',
];
export const ICON_MESSAGE = ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'];
export const ICON_FOLDER = ['M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'];
export const ICON_LIST = ['m3 5 2 2 4-4', 'M13 6h8', 'M13 12h8', 'M13 18h8', 'm3 13 2 2 4-4'];

export function focusSoon(input: HTMLInputElement): void {
  // rAF: the element has to be in the document and laid out before focus sticks.
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}
