// A DOM small enough to test the client against, and no larger.
//
// The plugin ships with zero runtime dependencies and only `typescript` as a
// devDependency (SPEC-v3 §3, §13.1), so jsdom is not an option. This implements
// exactly the surface the client touches: element creation, attributes, classes,
// a single-simple-selector query engine, bubbling events, focus and localStorage.

class ClassList {
  constructor(element) {
    this.element = element;
  }

  get _set() {
    return new Set((this.element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean));
  }

  _write(set) {
    this.element.setAttribute('class', [...set].join(' '));
  }

  add(...names) {
    const set = this._set;
    for (const name of names) set.add(name);
    this._write(set);
  }

  remove(...names) {
    const set = this._set;
    for (const name of names) set.delete(name);
    this._write(set);
  }

  contains(name) {
    return this._set.has(name);
  }

  toggle(name, force) {
    const on = force ?? !this.contains(name);
    if (on) this.add(name); else this.remove(name);
    return on;
  }
}

class FakeEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.target = init.target ?? null;
    this.currentTarget = null;
    this.key = init.key;
    this.relatedTarget = init.relatedTarget ?? null;
    this.defaultPrevented = false;
    this._stopped = false;
  }

  preventDefault() {
    this.defaultPrevented = true;
  }

  stopPropagation() {
    this._stopped = true;
  }
}

/** Supports one simple selector: `tag`, `.class`, `[attr]` or `[attr="value"]`. */
function matches(element, selector) {
  const attribute = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);
  if (attribute) {
    const value = element.getAttribute(attribute[1]);
    return attribute[2] === undefined ? value !== null : value === attribute[2];
  }
  if (selector.startsWith('.')) return element.classList.contains(selector.slice(1));
  return element.tagName === selector.toLowerCase();
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = new Map();
    this.listeners = new Map();
    this.classList = new ClassList(this);
    this.ownText = '';
    this.value = '';
    this.disabled = false;
  }

  // --- attributes -----------------------------------------------------------

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  get className() {
    return this.getAttribute('class') ?? '';
  }

  set className(value) {
    this.setAttribute('class', value);
  }

  get title() {
    return this.getAttribute('title') ?? '';
  }

  set title(value) {
    this.setAttribute('title', value);
  }

  get tabIndex() {
    const raw = this.getAttribute('tabindex');
    return raw === null ? -1 : Number(raw);
  }

  set tabIndex(value) {
    this.setAttribute('tabindex', String(value));
  }

  get dataset() {
    const data = {};
    for (const [name, value] of this.attributes) {
      if (!name.startsWith('data-')) continue;
      const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      data[key] = value;
    }
    return data;
  }

  // --- tree -----------------------------------------------------------------

  appendChild(child) {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  replaceChildren(...children) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    this.ownText = '';
    for (const child of children) this.appendChild(child);
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.childNodes = this.parentNode.childNodes.filter((node) => node !== this);
    this.parentNode = null;
  }

  get textContent() {
    return this.ownText + this.childNodes.map((child) => child.textContent).join('');
  }

  set textContent(value) {
    this.childNodes = [];
    this.ownText = String(value);
  }

  contains(node) {
    for (let current = node; current; current = current.parentNode) if (current === this) return true;
    return false;
  }

  closest(selector) {
    for (let current = this; current; current = current.parentNode) {
      if (current instanceof FakeElement && matches(current, selector)) return current;
    }
    return null;
  }

  querySelectorAll(selector) {
    const found = [];
    const walk = (element) => {
      for (const child of element.childNodes) {
        if (matches(child, selector)) found.push(child);
        walk(child);
      }
    };
    walk(this);
    return found;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  // --- events ---------------------------------------------------------------

  addEventListener(type, handler, options) {
    const key = `${type}${options === true || options?.capture ? ':capture' : ''}`;
    if (!this.listeners.has(key)) this.listeners.set(key, new Set());
    this.listeners.get(key).add(handler);
  }

  removeEventListener(type, handler, options) {
    const key = `${type}${options === true || options?.capture ? ':capture' : ''}`;
    this.listeners.get(key)?.delete(handler);
  }

  listenerCount() {
    let total = 0;
    for (const handlers of this.listeners.values()) total += handlers.size;
    return total;
  }

  dispatchEvent(event) {
    event.target = event.target ?? this;

    const path = [];
    for (let current = this; current; current = current.parentNode) path.push(current);
    if (globalThis.document && !path.includes(globalThis.document)) path.push(globalThis.document);

    for (const node of [...path].reverse()) {
      for (const handler of node.listeners.get(`${event.type}:capture`) ?? []) {
        event.currentTarget = node;
        handler(event);
        if (event._stopped) return !event.defaultPrevented;
      }
    }

    for (const node of path) {
      for (const handler of node.listeners.get(event.type) ?? []) {
        event.currentTarget = node;
        handler(event);
        if (event._stopped) return !event.defaultPrevented;
      }
    }

    return !event.defaultPrevented;
  }

  // --- focus ----------------------------------------------------------------

  focus() {
    const previous = globalThis.document.activeElement;
    if (previous === this) return;
    globalThis.document.activeElement = this;
    if (previous && previous !== globalThis.document.body) {
      previous.dispatchEvent(new FakeEvent('blur', { target: previous }));
      previous.dispatchEvent(new FakeEvent('focusout', { target: previous, relatedTarget: this }));
    }
  }

  blur() {
    if (globalThis.document.activeElement !== this) return;
    globalThis.document.activeElement = globalThis.document.body;
    this.dispatchEvent(new FakeEvent('blur', { target: this }));
    this.dispatchEvent(new FakeEvent('focusout', { target: this, relatedTarget: null }));
  }

  select() {
    this.selected = true;
  }

  click() {
    this.dispatchEvent(new FakeEvent('click', { target: this }));
  }
}

class FakeDocument extends FakeElement {
  constructor() {
    super('#document');
    this.head = new FakeElement('head');
    this.body = new FakeElement('body');
    this.head.parentNode = this;
    this.body.parentNode = this;
    this.childNodes = [this.head, this.body];
    this.activeElement = this.body;
  }

  createElement(tagName) {
    return new FakeElement(tagName);
  }

  /** SVG icons are built through the namespaced API; the shim treats them as plain elements. */
  createElementNS(_namespace, tagName) {
    return new FakeElement(tagName);
  }

  createTextNode(text) {
    const node = new FakeElement('#text');
    node.ownText = String(text);
    return node;
  }

  getElementById(id) {
    return this.querySelectorAll(`[id="${id}"]`)[0] ?? null;
  }
}

class FakeStorage {
  constructor() {
    this.map = new Map();
  }

  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  setItem(key, value) {
    this.map.set(key, String(value));
  }

  removeItem(key) {
    this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }
}

/** Installs the fake DOM as globals and returns handles plus a reset helper. */
export function installDom() {
  const document = new FakeDocument();
  const pending = [];

  globalThis.document = document;
  globalThis.HTMLElement = FakeElement;
  globalThis.HTMLInputElement = FakeElement;
  globalThis.Node = FakeElement;
  globalThis.localStorage = new FakeStorage();
  globalThis.requestAnimationFrame = (callback) => {
    pending.push(callback);
    return pending.length;
  };
  globalThis.cancelAnimationFrame = () => undefined;

  return {
    document,
    /** Runs queued rAF callbacks — focus and selection happen there. */
    flushFrames() {
      while (pending.length > 0) pending.shift()();
    },
  };
}

export function makeElement(tagName = 'div') {
  return new FakeElement(tagName);
}

export function fire(element, type, init = {}) {
  return element.dispatchEvent(new FakeEvent(type, { target: element, ...init }));
}

export { FakeElement, FakeEvent };
