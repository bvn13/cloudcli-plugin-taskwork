// Backend contract tests — T-B1..T-B15 of SPEC-v3 §15.1.
// They run against the built server (build/), over real HTTP, with HOME pointed
// at a throwaway directory so the developer's own store is never touched.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { Repository } from '../build/server/repository.js';
import { createServer } from '../build/server/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let home;
let server;
let base;

/** Fresh HOME + fresh server for every test: no state leaks between cases. */
async function restart() {
  if (server) await new Promise((resolve) => server.close(resolve));
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'taskwork-test-'));
  process.env.HOME = home;
  server = createServer(Repository.open(), '0.1.0');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}

async function call(method, endpoint, body) {
  const response = await fetch(`${base}${endpoint}`, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() };
}

const createTask = async (title) => (await call('POST', '/tasks', { title })).body.task;

describe('taskwork backend', () => {
  const originalHome = process.env.HOME;

  before(restart);
  beforeEach(restart);
  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    process.env.HOME = originalHome;
  });

  it('T-B1: E3 creates a task with a unique id and an ISO createdAt', async () => {
    const first = await call('POST', '/tasks', { title: '  Refactor billing  ' });
    assert.equal(first.status, 200);
    assert.equal(first.body.task.title, 'Refactor billing');
    assert.match(first.body.task.id, /^tsk_[0-9A-Z]{16}$/);
    assert.equal(new Date(first.body.task.createdAt).toISOString(), first.body.task.createdAt);
    assert.deepEqual(first.body.task.attachments, []);

    const second = await createTask('Second');
    assert.notEqual(first.body.task.id, second.id);
  });

  it('T-B2: E2 returns tasks strictly by createdAt DESC', async () => {
    const older = await createTask('Older');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = await createTask('Newer');

    const listed = (await call('GET', '/tasks')).body.tasks;
    assert.deepEqual(listed.map((t) => t.id), [newer.id, older.id]);
  });

  it('T-B3: E4 updates title and updatedAt, leaves createdAt alone', async () => {
    const task = await createTask('Before');
    await new Promise((resolve) => setTimeout(resolve, 5));

    const renamed = (await call('PATCH', `/tasks/${task.id}`, { title: 'After' })).body.task;
    assert.equal(renamed.title, 'After');
    assert.equal(renamed.createdAt, task.createdAt);
    assert.ok(renamed.updatedAt > task.updatedAt, 'updatedAt must move forward');

    const missing = await call('PATCH', '/tasks/tsk_missing', { title: 'x' });
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'NOT_FOUND');
  });

  it('T-B4: title validation rejects empty, blank and over-long values', async () => {
    for (const title of ['', '   ', 'x'.repeat(201), 42, null]) {
      const response = await call('POST', '/tasks', { title });
      assert.equal(response.status, 400, `title ${JSON.stringify(title)} must be rejected`);
      assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    }
    assert.equal((await call('POST', '/tasks', { title: 'x'.repeat(200) })).status, 200);
  });

  it('T-B5: E6 attaches a project; the same project on another task is 409', async () => {
    const first = await createTask('First');
    const second = await createTask('Second');

    const attached = await call('POST', `/tasks/${first.id}/attachments`, { projectId: 'proj_a', projectName: 'digital-ui' });
    assert.equal(attached.status, 200);
    assert.equal(attached.body.task.attachments.length, 1);
    assert.equal(attached.body.task.attachments[0].sessionId, null);

    const conflict = await call('POST', `/tasks/${second.id}/attachments`, { projectId: 'proj_a', projectName: 'digital-ui' });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error.code, 'PROJECT_ALREADY_ATTACHED');
  });

  it('T-B6: E6 twice on the same task is 409 (INV-4)', async () => {
    const task = await createTask('Task');
    await call('POST', `/tasks/${task.id}/attachments`, { projectId: 'proj_a', projectName: 'a' });

    const again = await call('POST', `/tasks/${task.id}/attachments`, { projectId: 'proj_a', projectName: 'a' });
    assert.equal(again.status, 409);
  });

  it('T-B7: E7 releases the project for another task', async () => {
    const first = await createTask('First');
    const second = await createTask('Second');
    await call('POST', `/tasks/${first.id}/attachments`, { projectId: 'proj_a', projectName: 'a' });

    const detached = await call('DELETE', `/tasks/${first.id}/attachments/proj_a`);
    assert.equal(detached.status, 200);
    assert.deepEqual(detached.body.task.attachments, []);

    assert.equal((await call('POST', `/tasks/${second.id}/attachments`, { projectId: 'proj_a', projectName: 'a' })).status, 200);
    assert.equal((await call('DELETE', `/tasks/${first.id}/attachments/proj_a`)).status, 404);
  });

  it('T-B8: E5 deletes the task and frees all of its projects', async () => {
    const first = await createTask('First');
    const second = await createTask('Second');
    await call('POST', `/tasks/${first.id}/attachments`, { projectId: 'proj_a', projectName: 'a' });
    await call('POST', `/tasks/${first.id}/attachments`, { projectId: 'proj_b', projectName: 'b' });

    const deleted = await call('DELETE', `/tasks/${first.id}`);
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleted.body, { deleted: true });
    assert.deepEqual((await call('GET', '/locked-projects')).body.lockedProjectIds, []);

    assert.equal((await call('POST', `/tasks/${second.id}/attachments`, { projectId: 'proj_a', projectName: 'a' })).status, 200);
    assert.equal((await call('DELETE', `/tasks/${first.id}`)).status, 404);
  });

  it('T-B9: E9 returns every attached projectId across all tasks', async () => {
    const first = await createTask('First');
    const second = await createTask('Second');
    await call('POST', `/tasks/${first.id}/attachments`, { projectId: 'proj_a', projectName: 'a' });
    await call('POST', `/tasks/${second.id}/attachments`, { projectId: 'proj_b', projectName: 'b' });

    const locked = (await call('GET', '/locked-projects')).body.lockedProjectIds;
    assert.deepEqual([...locked].sort(), ['proj_a', 'proj_b']);
  });

  it('T-B10: a corrupt tasks.json is backed up and the server starts empty', async () => {
    const dir = path.join(home, '.claude-code-ui', 'taskwork');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'tasks.json'), '{ this is not json');

    const repository = Repository.open(dir);
    assert.deepEqual(repository.listTasks(), []);

    const backups = fs.readdirSync(dir).filter((f) => f.startsWith('tasks.corrupt-'));
    assert.equal(backups.length, 1);
    assert.equal(fs.readFileSync(path.join(dir, backups[0]), 'utf8'), '{ this is not json');

    // The recovered store still works and persists.
    await repository.createTask('After recovery');
    assert.equal(Repository.open(dir).listTasks().length, 1);
  });

  it('T-B11: 20 concurrent attaches on one project yield exactly one 200', async () => {
    const tasks = await Promise.all(Array.from({ length: 20 }, (_, i) => createTask(`Task ${i}`)));

    const results = await Promise.all(tasks.map((task) =>
      call('POST', `/tasks/${task.id}/attachments`, { projectId: 'proj_hot', projectName: 'hot' })));

    assert.equal(results.filter((r) => r.status === 200).length, 1);
    assert.equal(results.filter((r) => r.status === 409).length, 19);
    assert.deepEqual((await call('GET', '/locked-projects')).body.lockedProjectIds, ['proj_hot']);
  });

  it('T-B12/T-B13: the first stdout line is the ready JSON, logs go to stderr', async () => {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'taskwork-boot-'));
    const child = spawn(process.execPath, [path.join(root, 'build/server/index.js')], {
      cwd: root,
      env: { PATH: process.env.PATH, HOME: sandbox, NODE_ENV: 'production', PLUGIN_NAME: 'taskwork' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ready line within 10 s: ${stderr}`)), 10_000);
      child.stdout.on('data', () => {
        const line = stdout.split('\n')[0];
        if (!line) return;
        clearTimeout(timer);
        resolve(JSON.parse(line));
      });
      child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`exited early (${code}): ${stderr}`)); });
    });

    assert.equal(ready.ready, true);
    assert.equal(typeof ready.port, 'number');

    const health = await (await fetch(`http://127.0.0.1:${ready.port}/health`)).json();
    assert.deepEqual(health, { status: 'ok', version: JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version });

    // T-B13: nothing but the ready line on stdout; the listening log went to stderr.
    assert.equal(stdout.trim().split('\n').length, 1);
    assert.match(stderr, /\[taskwork\] listening on 127\.0\.0\.1:\d+/);

    // Graceful shutdown within the host's 5 s budget.
    const exited = new Promise((resolve) => child.on('exit', resolve));
    child.kill('SIGTERM');
    const exitCode = await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 5000)),
    ]);
    assert.equal(exitCode, 0);
  });

  it('T-B14: traversal in a path parameter is a 400', async () => {
    for (const endpoint of ['/tasks/..%2F..%2Fetc', '/tasks/a%2F..%2Fb', '/tasks/tsk_a/attachments/..%2F..']) {
      const response = await call('DELETE', endpoint);
      assert.equal(response.status, 400, `${endpoint} must be rejected`);
      assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    }
  });

  it('T-B15: E8 records the sessionId', async () => {
    const task = await createTask('Task');
    await call('POST', `/tasks/${task.id}/attachments`, { projectId: 'proj_a', projectName: 'a' });

    const updated = await call('PATCH', `/tasks/${task.id}/attachments/proj_a`, { sessionId: 'sess_42' });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.task.attachments[0].sessionId, 'sess_42');

    assert.equal((await call('PATCH', `/tasks/${task.id}/attachments/proj_a`, { sessionId: '  ' })).status, 400);
    assert.equal((await call('PATCH', `/tasks/${task.id}/attachments/proj_zz`, { sessionId: 'x' })).status, 404);
  });

  it('unknown endpoints and malformed JSON are reported as such', async () => {
    assert.equal((await call('GET', '/nope')).status, 404);

    const malformed = await fetch(`${base}/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json',
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error.code, 'VALIDATION_ERROR');
  });

  it('data survives a restart of the plugin process', async () => {
    const task = await createTask('Persistent');
    await call('POST', `/tasks/${task.id}/attachments`, { projectId: 'proj_a', projectName: 'a' });

    const reopened = Repository.open(path.join(home, '.claude-code-ui', 'taskwork'));
    assert.equal(reopened.listTasks()[0].title, 'Persistent');
    assert.deepEqual(reopened.lockedProjectIds(), ['proj_a']);
  });
});
