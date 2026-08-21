// Frontend tests — T-F1..T-F9 of SPEC-v3 §15.2.
//
// Pure helpers are imported from the compiled client modules; mount/unmount is
// exercised against the shipped single-file bundle, so what the host actually
// loads is what is under test.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { installDom, fire } from './helpers/dom.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The DOM has to exist before the bundle is imported: it captures nothing at
// module scope, but its helpers reference `document` as soon as they run.
let dom = installDom();

const { formatCompactAge } = await import('../build/shared/age.js');
const { detect } = await import('../build/.tsc-client/client/capabilities.js');
const { ContextOnlyBridge, HostApiBridge, basename } = await import('../build/.tsc-client/client/host-bridge.js');
const { availableProjects, sortProjectsByDisplayName } = await import('../build/.tsc-client/client/views/ProjectPicker.js');
const bundle = await import('../build/client/index.js');

const sample = (overrides = {}) => ({
  id: 'tsk_1',
  title: 'Refactor billing',
  createdAt: '2026-08-21T09:00:00.000Z',
  updatedAt: '2026-08-21T09:00:00.000Z',
  attachments: [],
  ...overrides,
});

/**
 * Minimal stand-in for the host's plugin API. `host` is left undefined to model
 * a stock host; passing one models a host carrying PR-2.
 */
function fakeApi({ tasks = [], locked = [], project = null, host, surface } = {}) {
  const listeners = new Set();
  const calls = [];

  const api = {
    context: { theme: 'dark', project, session: null },
    onContextChange(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    async rpc(method, endpoint, body) {
      calls.push({ method, path: endpoint, body });
      if (method === 'GET' && endpoint === '/tasks') return { tasks };
      if (method === 'GET' && endpoint === '/locked-projects') return { lockedProjectIds: locked };
      if (method === 'POST' && endpoint === '/tasks') {
        const task = sample({ id: `tsk_${tasks.length + 1}`, title: body.title });
        tasks = [task, ...tasks];
        return { task };
      }
      if (method === 'PATCH' && /\/attachments\//.test(endpoint)) {
        const projectId = endpoint.split('/').pop();
        const task = tasks[0];
        task.attachments = task.attachments.map((a) =>
          (a.projectId === projectId ? { ...a, sessionId: body.sessionId } : a));
        return { task };
      }
      if (method === 'POST' && /\/attachments$/.test(endpoint)) {
        if (locked.includes(body.projectId)) throw new Error('RPC error 409');
        const task = tasks[0];
        task.attachments = [...task.attachments, { ...body, attachedAt: new Date().toISOString(), sessionId: null }];
        locked = [...locked, body.projectId];
        return { task };
      }
      throw new Error('RPC error 404');
    },
    calls,
    emitContext(next) {
      api.context = { ...api.context, ...next };
      for (const listener of listeners) listener(api.context);
    },
    listenerCount: () => listeners.size,
  };

  if (host) api.host = host;
  if (surface) api.surface = surface;
  return api;
}

const settle = async () => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  dom.flushFrames();
};

/** Containers mounted by a test, so a failed assertion cannot leak a live timer. */
const mounted = new Set();

function mount(container, api) {
  mounted.add(container);
  bundle.mount(container, api);
}

function unmount(container) {
  mounted.delete(container);
  bundle.unmount(container);
}

describe('taskwork frontend', () => {
  beforeEach(() => {
    dom = installDom();
  });

  afterEach(() => {
    for (const container of mounted) bundle.unmount(container);
    mounted.clear();
    dom.flushFrames();
  });

  it('T-F1: formatCompactAge matches the host formatter', () => {
    const now = new Date('2026-08-21T12:00:00.000Z');
    const ago = (ms) => new Date(now.getTime() - ms).toISOString();

    assert.equal(formatCompactAge(ago(0), now), '<1m');
    assert.equal(formatCompactAge(ago(59_000), now), '<1m');
    assert.equal(formatCompactAge(ago(60_000), now), '1m');
    assert.equal(formatCompactAge(ago(59 * 60_000), now), '59m');
    assert.equal(formatCompactAge(ago(60 * 60_000), now), '1hr');
    assert.equal(formatCompactAge(ago(23 * 3600_000), now), '23hr');
    assert.equal(formatCompactAge(ago(24 * 3600_000), now), '1d');
    assert.equal(formatCompactAge(ago(6 * 24 * 3600_000), now), '6d');
    assert.equal(formatCompactAge(null, now), '');
    assert.equal(formatCompactAge(undefined, now), '');
    assert.equal(formatCompactAge('not a date', now), '');
    // A clock that ran backwards must not produce a negative age.
    assert.equal(formatCompactAge(new Date(now.getTime() + 60_000).toISOString(), now), '<1m');
  });

  it('T-F2: the drop-down sorts by displayName, case-insensitively, not by path', () => {
    const projects = [
      { projectId: 'p1', displayName: 'zeta', fullPath: '/aaa/zeta' },
      { projectId: 'p2', displayName: 'Alpha', fullPath: '/zzz/alpha' },
      { projectId: 'p3', displayName: 'beta', fullPath: '/mmm/beta' },
    ];

    assert.deepEqual(
      sortProjectsByDisplayName(projects).map((p) => p.displayName),
      ['Alpha', 'beta', 'zeta'],
    );
    // Sorting by fullPath would have produced zeta, beta, Alpha.
    assert.notDeepEqual(
      sortProjectsByDisplayName(projects).map((p) => p.fullPath),
      [...projects].sort((a, b) => a.fullPath.localeCompare(b.fullPath)).map((p) => p.fullPath),
    );
  });

  it('T-F3: attached projects are filtered out of the drop-down', () => {
    const projects = [
      { projectId: 'p1', displayName: 'alpha', fullPath: '/a' },
      { projectId: 'p2', displayName: 'beta', fullPath: '/b' },
      { projectId: 'p3', displayName: 'gamma', fullPath: '/c' },
    ];

    assert.deepEqual(
      availableProjects(projects, ['p2']).map((p) => p.projectId),
      ['p1', 'p3'],
    );
    assert.deepEqual(availableProjects(projects, ['p1', 'p2', 'p3']), []);
  });

  it('T-F5: a stock api reports the stock capabilities', () => {
    assert.deepEqual(detect({}), { surface: 'tab', canFetchHost: false, canNavigate: false });
    assert.deepEqual(detect(null), { surface: 'tab', canFetchHost: false, canNavigate: false });
    assert.deepEqual(
      detect({ surface: 'sidebar', host: { fetch() {}, startNewSession() {}, openSession() {} } }),
      { surface: 'sidebar', canFetchHost: true, canNavigate: true },
    );
    // A half-implemented host API degrades field by field.
    assert.deepEqual(
      detect({ host: { fetch() {} } }),
      { surface: 'tab', canFetchHost: true, canNavigate: false },
    );
  });

  it('T-F7: no auth-token access anywhere, and the stock bridge never fetches', async () => {
    const sources = [];
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else sources.push(full);
    });
    walk(path.join(root, 'src'));

    for (const file of [...sources, path.join(root, 'build/client/index.js')]) {
      const code = fs.readFileSync(file, 'utf8');
      assert.doesNotMatch(code, /auth-token/, `${path.relative(root, file)} must not mention auth-token`);
      const keys = [...code.matchAll(/localStorage\.\w+\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
      for (const key of keys) {
        assert.match(key, /^taskwork:/, `${path.relative(root, file)} touches localStorage key ${key}`);
      }
    }

    // Runtime half: the context-only bridge issues no request at all.
    let fetchCalls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = () => { fetchCalls += 1; throw new Error('stock mode must not fetch'); };

    const api = fakeApi({ project: { name: 'proj_a', path: '/home/dev/digital-ui' } });
    const bridge = new ContextOnlyBridge(api, detect(api));

    assert.deepEqual(await bridge.listProjects(), [
      { projectId: 'proj_a', displayName: 'digital-ui', fullPath: '/home/dev/digital-ui' },
    ]);
    assert.deepEqual(await bridge.listSessions('proj_a', 1), []);
    await assert.rejects(() => bridge.startNewSession('proj_a'), /NOT_SUPPORTED/);
    await assert.rejects(() => bridge.openSession('proj_a', 's1'), /NOT_SUPPORTED/);
    assert.equal(fetchCalls, 0);

    globalThis.fetch = realFetch;
  });

  it('T-F4: mount → unmount → mount leaves no listeners or timers behind', async () => {
    // Counted through the runtime rather than by patching globalThis.setInterval:
    // the test runner uses those globals itself.
    const timers = () => process.getActiveResourcesInfo().filter((resource) => resource === 'Timeout').length;
    const baseline = timers();

    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    const api = fakeApi({ tasks: [sample()] });

    mount(container, api);
    await settle();
    assert.equal(timers(), baseline + 1, 'the age timer is running');
    assert.equal(api.listenerCount(), 1);
    assert.ok(dom.document.listenerCount() > 0, 'the outside-click listener is registered');

    unmount(container);
    assert.equal(timers(), baseline, 'the age timer must be cleared');
    assert.equal(api.listenerCount(), 0, 'onContextChange must be unsubscribed');
    assert.equal(dom.document.listenerCount(), 0, 'document listeners must be removed');
    assert.equal(container.childNodes.length, 0, 'the container must be emptied');

    mount(container, api);
    await settle();
    assert.equal(timers(), baseline + 1);
    assert.equal(api.listenerCount(), 1);

    unmount(container);
    assert.equal(timers(), baseline);
    assert.equal(dom.document.listenerCount(), 0);
  });

  it('T-F6: two containers are mounted independently', async () => {
    const first = dom.document.createElement('div');
    const second = dom.document.createElement('div');
    dom.document.body.appendChild(first);
    dom.document.body.appendChild(second);

    const tabApi = fakeApi({ tasks: [sample({ title: 'In the tab' })] });
    const sidebarApi = fakeApi({ tasks: [sample({ title: 'In the sidebar' })], surface: 'sidebar' });

    mount(first, tabApi);
    mount(second, sidebarApi);
    await settle();

    assert.match(first.childNodes[0].className, /tw-surface-tab/);
    assert.match(second.childNodes[0].className, /tw-surface-sidebar/);
    assert.match(first.textContent, /In the tab/);
    assert.match(second.textContent, /In the sidebar/);

    unmount(first);
    assert.equal(first.childNodes.length, 0);
    // The second instance keeps working after the first one is gone.
    assert.match(second.textContent, /In the sidebar/);
    assert.equal(sidebarApi.listenerCount(), 1);

    unmount(second);
  });

  it('T-F8: stock mode enables Attach only for a free, selected project', async () => {
    const attachButton = (container) => container
      .querySelectorAll('[data-role="attach-current"]')[0] ?? null;

    // Expanded task, project selected and free -> enabled.
    globalThis.localStorage.setItem('taskwork:expanded', JSON.stringify(['tsk_1']));
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    const api = fakeApi({ tasks: [sample()], project: { name: 'proj_a', path: '/home/dev/digital-ui' } });

    mount(container, api);
    await settle();

    const enabled = attachButton(container);
    assert.ok(enabled, 'the attach button is rendered for an expanded task');
    assert.equal(enabled.disabled, false);
    assert.match(enabled.textContent, /Attach “digital-ui”/);
    assert.match(container.textContent, /Limited mode/);
    unmount(container);

    // No project selected -> disabled with a hint.
    const emptyApi = fakeApi({ tasks: [sample()], project: null });
    mount(container, emptyApi);
    await settle();
    const disabled = attachButton(container);
    assert.equal(disabled.disabled, true);
    assert.match(container.textContent, /Select a project first/);
    unmount(container);

    // Project already held by another task -> disabled with the exclusivity hint.
    const lockedApi = fakeApi({
      tasks: [sample()],
      locked: ['proj_a'],
      project: { name: 'proj_a', path: '/home/dev/digital-ui' },
    });
    mount(container, lockedApi);
    await settle();
    assert.equal(attachButton(container).disabled, true);
    assert.match(container.textContent, /already used by another task/);
    unmount(container);
  });

  it('T-F9: a context change relabels the attach button', async () => {
    globalThis.localStorage.setItem('taskwork:expanded', JSON.stringify(['tsk_1']));
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    const api = fakeApi({ tasks: [sample()], project: { name: 'proj_a', path: '/home/dev/digital-ui' } });

    mount(container, api);
    await settle();
    assert.match(container.textContent, /Attach “digital-ui”/);

    api.emitContext({ project: { name: 'proj_b', path: '/home/dev/event-planning' }, theme: 'light' });
    await settle();
    assert.match(container.textContent, /Attach “event-planning”/);
    assert.ok(container.childNodes[0].classList.contains('tw-theme-light'));

    unmount(container);
  });

  it('creating a task: Enter saves, blur discards, empty input cancels', async () => {
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    const api = fakeApi({ tasks: [] });

    mount(container, api);
    await settle();
    assert.match(container.textContent, /No tasks yet/);

    const addButton = () => container.querySelectorAll('[aria-label="Add new task"]')[0];
    const draftInput = () => container.querySelectorAll('[placeholder="Task name"]')[0] ?? null;

    // Blur drops the draft.
    addButton().click();
    assert.ok(draftInput());
    draftInput().value = 'Never saved';
    fire(draftInput(), 'blur');
    await settle();
    assert.equal(draftInput(), null);
    assert.equal(api.calls.filter((c) => c.method === 'POST').length, 0);

    // Enter saves it, and the blur that follows must not undo the save.
    addButton().click();
    const input = draftInput();
    input.value = '  Migrate to Vite  ';
    fire(input, 'keydown', { key: 'Enter' });
    fire(input, 'blur');
    await settle();

    const created = api.calls.find((c) => c.method === 'POST' && c.path === '/tasks');
    assert.equal(created.body.title, 'Migrate to Vite', 'the client trims before sending');
    assert.match(container.textContent, /Migrate to Vite/);
    assert.equal(draftInput(), null);

    // Whitespace-only input just cancels.
    addButton().click();
    draftInput().value = '   ';
    fire(draftInput(), 'keydown', { key: 'Enter' });
    await settle();
    assert.equal(api.calls.filter((c) => c.method === 'POST' && c.path === '/tasks').length, 1);

    unmount(container);
  });

  it('full mode lists the host projects and starts a session on attach', async () => {
    globalThis.localStorage.setItem('taskwork:expanded', JSON.stringify(['tsk_1']));

    const started = [];
    const opened = [];
    const host = {
      async fetch(url) {
        if (url.startsWith('/api/projects?')) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              { projectId: 'proj_a', displayName: 'digital-ui', fullPath: '/home/dev/digital-ui' },
              { projectId: 'proj_b', displayName: 'Event planning', fullPath: '/home/dev/event' },
            ],
          };
        }
        return { ok: true, status: 200, json: async () => ({ sessions: [] }) };
      },
      startNewSession: (projectId) => started.push(projectId),
      openSession: (projectId, sessionId) => opened.push([projectId, sessionId]),
    };

    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    const api = fakeApi({ tasks: [sample()], locked: ['proj_b'], host });

    mount(container, api);
    await settle();
    assert.doesNotMatch(container.textContent, /Limited mode/);

    container.querySelectorAll('[data-role="add-project"]')[0].click();
    await settle();

    const options = container.querySelectorAll('[role="option"]');
    assert.deepEqual(options.map((o) => o.textContent), ['digital-ui'], 'the locked project is not offered');

    options[0].click();
    await settle();

    assert.deepEqual(started, ['proj_a']);
    // Title and session live on separate lines, as in the host's own session rows.
    assert.match(container.textContent, /digital-ui/);
    assert.match(container.textContent, /New chat/);
    assert.equal(opened.length, 0);

    unmount(container);
  });

  it('an attachment never adopts a session that predates it', async () => {
    globalThis.localStorage.setItem('taskwork:expanded', JSON.stringify(['tsk_1']));

    const attachedAt = '2026-08-21T12:00:00.000Z';
    const sessionsOf = (createdAt) => ({
      ok: true,
      status: 200,
      json: async () => ({ sessions: [{ id: 'sess_old', title: 'Yesterday’s chat', createdAt }] }),
    });

    const withSession = (createdAt) => {
      const task = sample({
        attachments: [{ projectId: 'proj_a', projectName: 'digital-ui', attachedAt, sessionId: null }],
      });
      return fakeApi({
        tasks: [task],
        host: {
          fetch: async (url) => (url.startsWith('/api/projects?')
            ? { ok: true, status: 200, json: async () => [{ projectId: 'proj_a', displayName: 'digital-ui', fullPath: '/p' }] }
            : sessionsOf(createdAt)),
          startNewSession() {},
          openSession() {},
        },
      });
    };

    // Session created before the attachment: the node stays a pending new chat.
    const container = dom.document.createElement('div');
    dom.document.body.appendChild(container);
    const staleApi = withSession('2026-08-20T09:00:00.000Z');
    mount(container, staleApi);
    await settle();

    assert.match(container.textContent, /New chat/);
    assert.doesNotMatch(container.textContent, /Yesterday/);
    assert.equal(staleApi.calls.filter((c) => c.method === 'PATCH').length, 0, 'nothing to bind');
    unmount(container);

    // Session created after the attachment: adopted and pinned through E8.
    const freshApi = withSession('2026-08-21T12:00:05.000Z');
    mount(container, freshApi);
    await settle();

    assert.match(container.textContent, /Yesterday’s chat/);
    const bind = freshApi.calls.find((c) => c.method === 'PATCH');
    assert.ok(bind, 'the session is pinned with E8');
    assert.deepEqual(bind.body, { sessionId: 'sess_old' });
    unmount(container);
  });

  it('the host bridge reports an expired session instead of retrying', async () => {
    const api = fakeApi({
      host: {
        fetch: async () => ({ ok: false, status: 401, json: async () => ({}) }),
        startNewSession() {},
        openSession() {},
      },
    });
    const bridge = new HostApiBridge(api, detect(api));

    await assert.rejects(() => bridge.listProjects(), /Session expired/);
    assert.equal(basename('/home/dev/digital-ui'), 'digital-ui');
  });
});
