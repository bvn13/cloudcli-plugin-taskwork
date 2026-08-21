const STYLE_ID = 'taskwork-styles';

/**
 * The look is deliberately borrowed from the host's own project list, so the
 * task tree reads as part of the sidebar rather than as an embedded widget:
 * the same row padding, radius, hover accent, left rail under a parent node and
 * the same primary-coloured action button.
 *
 * The host publishes its palette as **raw HSL triples** (`--accent: 44 15% 91%`),
 * not as finished colours, so every reference has to go through
 * `hsl(var(--x) / a)` with a triple as the fallback. Using `var(--accent)`
 * directly yields an invalid colour and the element silently renders unstyled.
 */
const CSS = `
.tw-root {
  --tw-fg: hsl(var(--foreground, 0 0% 10%));
  --tw-muted: hsl(var(--muted-foreground, 0 0% 45%));
  --tw-border: hsl(var(--border, 0 0% 85%));
  --tw-accent: hsl(var(--accent, 0 0% 92%));
  --tw-accent-soft: hsl(var(--accent, 0 0% 92%) / 0.5);
  --tw-accent-fg: hsl(var(--accent-foreground, 0 0% 10%));
  --tw-primary: hsl(var(--primary, 221 83% 53%));
  --tw-primary-hover: hsl(var(--primary, 221 83% 53%) / 0.9);
  --tw-primary-fg: hsl(var(--primary-foreground, 0 0% 100%));
  --tw-danger: hsl(var(--destructive, 0 84% 60%));
  --tw-ring: hsl(var(--ring, 221 83% 53%));

  display: flex;
  flex-direction: column;
  gap: 4px;
  box-sizing: border-box;
  height: 100%;
  overflow: auto;
  padding: 8px 6px;
  color: var(--tw-fg);
  font-size: 14px;
  line-height: 1.35;
}
.tw-root *, .tw-root *::before, .tw-root *::after { box-sizing: border-box; }
.tw-root :focus-visible { outline: 2px solid var(--tw-ring); outline-offset: 1px; }

.tw-surface-tab { max-width: 720px; margin: 0 auto; padding: 16px; }

/* ── banners ─────────────────────────────────────────────────────────── */
.tw-banner {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin: 0 2px 4px; padding: 6px 10px;
  border: 1px solid var(--tw-border); border-radius: 8px;
  color: var(--tw-muted); font-size: 12px;
}
.tw-banner-error { color: var(--tw-fg); border-color: var(--tw-danger); }

/* ── buttons ─────────────────────────────────────────────────────────── */
.tw-button {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  height: 32px; padding: 0 10px;
  border: none; border-radius: 6px;
  background: var(--tw-primary); color: var(--tw-primary-fg);
  font: inherit; font-size: 12px; font-weight: 500;
  cursor: pointer; transition: background-color .15s;
}
.tw-button:hover:not(:disabled) { background: var(--tw-primary-hover); }
.tw-button:active:not(:disabled) { transform: scale(.98); }
.tw-button:disabled { opacity: .5; cursor: not-allowed; }
.tw-button-wide { width: 100%; }
.tw-button-quiet {
  background: transparent; color: var(--tw-fg);
  border: 1px solid var(--tw-border); font-weight: 400;
}
.tw-button-quiet:hover:not(:disabled) { background: var(--tw-accent-soft); }

/* ── tree ────────────────────────────────────────────────────────────── */
.tw-tree { display: flex; flex-direction: column; gap: 2px; }
.tw-group {
  display: flex; flex-direction: column; gap: 2px;
  margin: 2px 0 2px 12px; padding-left: 12px;
  border-left: 1px solid var(--tw-border);
}

.tw-node {
  display: flex; align-items: center; gap: 10px;
  width: 100%; padding: 8px; border-radius: 6px;
  background: transparent; text-align: left;
  cursor: pointer; transition: background-color .15s;
}
.tw-node:hover { background: var(--tw-accent-soft); }
.tw-node[aria-selected="true"] { background: var(--tw-accent); color: var(--tw-accent-fg); }
.tw-node-attachment { padding: 6px 8px; }
.tw-node-attachment[data-clickable="false"] { cursor: default; }
.tw-node-removed .tw-node-title { color: var(--tw-muted); text-decoration: line-through; }

.tw-node-icon {
  display: flex; align-items: center; justify-content: center;
  flex: 0 0 24px; width: 24px; height: 24px; border-radius: 4px;
  color: var(--tw-muted);
}
.tw-node-attachment .tw-node-icon {
  flex-basis: 20px; width: 20px; height: 20px;
  background: hsl(var(--muted, 0 0% 96%) / 0.6);
}
.tw-svg { width: 14px; height: 14px; }
.tw-node-attachment .tw-svg { width: 12px; height: 12px; }

.tw-node-text { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; }
.tw-node-title {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 14px; font-weight: 400; color: var(--tw-fg);
}
.tw-node-attachment .tw-node-title { font-size: 13px; }
.tw-node-subtitle {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12px; color: var(--tw-muted);
}
.tw-node-input {
  flex: 1 1 auto; min-width: 0;
  padding: 5px 8px; border: 2px solid hsl(var(--primary, 221 83% 53%) / 0.4); border-radius: 6px;
  background: hsl(var(--background, 0 0% 100%)); color: var(--tw-fg);
  font: inherit; font-size: 14px;
}
.tw-node-input:focus { border-color: var(--tw-primary); outline: none; }

.tw-age {
  flex: 0 0 auto; color: var(--tw-muted);
  font-size: 11px; font-variant-numeric: tabular-nums;
}
.tw-chevron {
  display: flex; align-items: center; justify-content: center;
  flex: 0 0 24px; width: 24px; height: 24px; border-radius: 4px;
  border: none; background: transparent; color: var(--tw-muted); cursor: pointer; padding: 0;
}
.tw-chevron:hover { background: var(--tw-accent); }

.tw-icon {
  display: flex; align-items: center; justify-content: center;
  flex: 0 0 24px; width: 24px; height: 24px; padding: 0;
  border: none; border-radius: 4px; background: transparent;
  color: var(--tw-muted); cursor: pointer;
  opacity: 0; transition: opacity .2s, background-color .15s;
}
.tw-node:hover .tw-icon, .tw-icon:focus-visible { opacity: 1; }
.tw-icon:hover { background: var(--tw-accent); color: var(--tw-fg); }
.tw-icon-danger:hover { color: var(--tw-danger); }

/* ── states ──────────────────────────────────────────────────────────── */
.tw-hint, .tw-empty, .tw-error { color: var(--tw-muted); font-size: 12px; padding: 8px; }
.tw-empty { text-align: center; padding: 24px 8px; }
.tw-error { color: var(--tw-danger); }

.tw-confirm {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin: 2px 0 2px 24px; padding: 8px 10px;
  border: 1px solid var(--tw-border); border-radius: 8px;
  background: hsl(var(--muted, 0 0% 96%) / 0.4);
  font-size: 12px;
}
.tw-confirm span { flex: 1 1 auto; min-width: 120px; }
.tw-confirm .tw-button { height: 28px; }

/* ── project picker ──────────────────────────────────────────────────── */
.tw-picker { display: flex; flex-direction: column; gap: 4px; padding: 2px 0; }
.tw-listbox {
  display: flex; flex-direction: column; gap: 2px;
  max-height: 240px; overflow: auto; padding: 4px;
  border: 1px solid var(--tw-border); border-radius: 8px;
  background: hsl(var(--popover, var(--background, 0 0% 100%)));
  box-shadow: 0 4px 12px hsl(0 0% 0% / .12);
}
.tw-option {
  display: flex; align-items: center; gap: 8px;
  width: 100%; min-height: 32px; padding: 6px 8px;
  border: none; border-radius: 6px; background: transparent;
  color: var(--tw-fg); font: inherit; font-size: 13px; text-align: left; cursor: pointer;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tw-option:hover, .tw-option[aria-selected="true"] { background: var(--tw-accent-soft); }
.tw-option[aria-disabled="true"] { color: var(--tw-muted); cursor: not-allowed; }
`;

/** Idempotent: the module may be mounted into two surfaces at once (§6.5). */
export function injectStyles(): void {
  const existing = document.getElementById(STYLE_ID);
  if (existing) {
    // Keep the newest rules when a rebuilt module is mounted into a live page.
    existing.textContent = CSS;
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}
