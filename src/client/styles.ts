const STYLE_ID = 'taskwork-styles';

/**
 * Colours come from the host's own CSS variables so the plugin follows the
 * active theme; every one has a fallback for hosts that do not define it.
 * All selectors are `.tw-` prefixed and scoped under `.tw-root`.
 */
const CSS = `
.tw-root {
  --tw-fg: var(--foreground, #e5e7eb);
  --tw-bg: var(--background, transparent);
  --tw-muted: var(--muted-foreground, #9ca3af);
  --tw-border: var(--border, rgba(127, 127, 127, 0.3));
  --tw-accent: var(--accent, rgba(127, 127, 127, 0.16));
  --tw-primary: var(--primary, #3b82f6);
  --tw-row: 32px;

  display: flex;
  flex-direction: column;
  gap: 4px;
  box-sizing: border-box;
  height: 100%;
  overflow: auto;
  padding: 8px;
  color: var(--tw-fg);
  background: var(--tw-bg);
  font-size: 13px;
  line-height: 1.35;
}
.tw-root *, .tw-root *::before, .tw-root *::after { box-sizing: border-box; }

.tw-surface-tab { max-width: 720px; margin: 0 auto; padding: 16px; }
.tw-surface-sidebar { padding: 6px 8px; }

.tw-banner {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 6px 8px; border: 1px solid var(--tw-border); border-radius: 6px;
  color: var(--tw-muted); font-size: 12px;
}
.tw-banner-error { color: var(--tw-fg); border-color: #ef4444; }
.tw-banner button { font-size: 12px; }

.tw-toolbar { display: flex; align-items: center; gap: 6px; }

.tw-button {
  display: inline-flex; align-items: center; gap: 6px;
  min-height: var(--tw-row); padding: 4px 8px;
  border: 1px solid var(--tw-border); border-radius: 6px;
  background: transparent; color: inherit; font: inherit; cursor: pointer;
}
.tw-button:hover:not(:disabled) { background: var(--tw-accent); }
.tw-button:disabled { opacity: 0.5; cursor: not-allowed; }
.tw-button-wide { width: 100%; justify-content: flex-start; }
.tw-button-quiet { border-color: transparent; color: var(--tw-muted); }

.tw-root :focus-visible { outline: 2px solid var(--tw-primary); outline-offset: 1px; }

.tw-tree { display: flex; flex-direction: column; }
.tw-group { display: flex; flex-direction: column; }

.tw-node {
  display: flex; align-items: center; gap: 6px;
  min-height: var(--tw-row); padding: 2px 4px; border-radius: 6px;
  cursor: default;
}
.tw-node:hover { background: var(--tw-accent); }
.tw-node[aria-selected="true"] { background: var(--tw-accent); }
.tw-node-attachment { padding-left: 22px; cursor: pointer; }
.tw-node-attachment[data-clickable="false"] { cursor: default; }
.tw-node-removed .tw-node-label { color: var(--tw-muted); }

.tw-chevron {
  display: inline-flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; flex: 0 0 18px;
  border: none; background: transparent; color: var(--tw-muted);
  font-size: 10px; cursor: pointer; padding: 0;
}

.tw-node-label {
  flex: 1 1 auto; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tw-node-input {
  flex: 1 1 auto; min-width: 0;
  padding: 2px 4px; border: 1px solid var(--tw-primary); border-radius: 4px;
  background: transparent; color: inherit; font: inherit;
}
.tw-age { flex: 0 0 auto; color: var(--tw-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.tw-chip { flex: 0 0 auto; color: var(--tw-muted); font-size: 11px; }

.tw-icon {
  display: none; align-items: center; justify-content: center;
  width: 24px; height: 24px; flex: 0 0 24px; padding: 0;
  border: none; border-radius: 4px; background: transparent;
  color: var(--tw-muted); cursor: pointer; font-size: 13px; line-height: 1;
}
.tw-node:hover .tw-icon, .tw-icon:focus-visible { display: inline-flex; }
.tw-icon:hover { color: var(--tw-fg); background: var(--tw-accent); }

.tw-hint, .tw-empty, .tw-error { color: var(--tw-muted); font-size: 12px; padding: 4px; }
.tw-error { color: #ef4444; }

.tw-confirm {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  padding: 4px 8px; margin-left: 22px;
  border: 1px solid var(--tw-border); border-radius: 6px; font-size: 12px;
}

.tw-picker { position: relative; }
.tw-listbox {
  display: flex; flex-direction: column;
  max-height: 220px; overflow: auto;
  border: 1px solid var(--tw-border); border-radius: 6px;
  background: var(--background, #111827);
}
.tw-option {
  display: block; width: 100%; text-align: left;
  min-height: var(--tw-row); padding: 4px 8px;
  border: none; background: transparent; color: inherit; font: inherit; cursor: pointer;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tw-option:hover, .tw-option[aria-selected="true"] { background: var(--tw-accent); }
.tw-option[aria-disabled="true"] { color: var(--tw-muted); cursor: not-allowed; }
`;

/** Idempotent: the module may be mounted into two surfaces at once (§6.5). */
export function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
