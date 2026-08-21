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
export function iconButton(className: string, label: string, glyph: string): HTMLButtonElement {
  return el('button', {
    className,
    text: glyph,
    attrs: { type: 'button', 'aria-label': label, title: label },
  });
}

export function focusSoon(input: HTMLInputElement): void {
  // rAF: the element has to be in the document and laid out before focus sticks.
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}
