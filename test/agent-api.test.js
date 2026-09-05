import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startService } from '../src/service-runtime.js';
import { discoverService, requestService } from '../src/service-client.js';

const execute = promisify(execFile);
const cli = path.resolve('bin/fabu.js');
const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jHZkAAAAASUVORK5CYII=', 'base64');
async function run(root, ...args) {
  try { const result = await execute(process.execPath, [cli, '--data-dir', root, '--json', ...args], { timeout: 30_000 }); return { ...result, code: 0, json: JSON.parse(result.stdout) }; }
  catch (error) { return { stdout: error.stdout, stderr: error.stderr, code: error.code, json: error.stdout ? JSON.parse(error.stdout) : null }; }
}

test('真实 CLI 经认证 HTTP 创建、验证、等待、幂等复用和查询图文任务；Web 复用同一服务', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fabu-api-'));
  const starts = [];
  const accounts = { getAccount: (_key, id) => id === 'test-account' ? { id, nickname: '测试账号' } : null, accountStatus: () => ({ douyin: [{ id: 'test-account', bound: true }] }) };
  const runtime = await startService({ dataRoot: root, port: 0, accounts, runnerFactory: (_type, _log, completed, progress) => ({
    hasOpenWindows: () => false, cancel: async () => {}, closeWindows: async () => {},
    async run(job) { starts.push(job); progress(job, 'filling', '填写图文'); completed(job, true); }
  }) });
  t.after(async () => { await runtime.shutdown(); fs.rmSync(root, { recursive: true, force: true }); });
  const image = path.join(root, '图片 空格.png');
  fs.writeFileSync(image, pngBytes);
  const manifest = path.join(root, '任务.json');
  fs.writeFileSync(manifest, JSON.stringify({ type: 'image_text', idempotency_key: 'api-1', media: { images: ['./图片 空格.png'] }, content: { title: '图文测试' }, targets: [{ platform: 'douyin', account_id: 'test-account' }] }));
  const noAuth = await fetch(`${runtime.instance.url}/api/v1/tasks`);
  assert.equal(noAuth.status, 401);
  assert.equal((await noAuth.json()).error.code, 'UNAUTHORIZED');
  const crossSite = await fetch(`${runtime.instance.url}/api/tasks`, { method: 'POST', headers: { Origin: 'https://example.com' } });
  assert.equal(crossSite.status, 403);
  const validated = await run(root, 'tasks', 'validate', '--file', manifest);
  assert.equal(validated.code, 0, validated.stdout);
  assert.equal(validated.json.data.valid, true);
  assert.equal(starts.length, 0);
  const created = await run(root, 'tasks', 'create', '--file', manifest);
  assert.equal(created.code, 0, created.stdout);
  const id = created.json.data.task.id;
  const waited = await run(root, 'tasks', 'wait', id, '--timeout', '5');
  assert.equal(waited.code, 0, waited.stdout);
  assert.equal(waited.json.data.outcome, 'prepared');
  const duplicate = await run(root, 'tasks', 'create', '--file', manifest);
  assert.equal(duplicate.json.data.reused, true);
  assert.equal(duplicate.json.data.task.id, id);
  assert.equal(starts.length, 1);
  const logs = await run(root, 'tasks', 'logs', id);
  assert.ok(logs.json.data.events.some(e => e.type === 'result'));
  const list = await run(root, 'tasks', 'list');
  assert.equal(list.json.data.tasks.length, 1);
  const legacy = await fetch(`${runtime.instance.url}/api/image-text/tasks/${id}`);
  assert.equal((await legacy.json()).id, id);
  const form = new FormData();
  form.append('images', new Blob([pngBytes], { type: 'image/png' }), 'web.png');
  form.append('title', '网页图文');
  form.append('targets', JSON.stringify([{ platform_key: 'douyin', account_id: 'test-account' }]));
  const web = await fetch(`${runtime.instance.url}/api/image-text/tasks`, { method: 'POST', body: form });
  assert.equal(web.status, 200, await web.clone().text());
  const webTask = await web.json();
  assert.equal(runtime.service.get(webTask.task_id).type, 'image_text');
  const rejected = await run(root, 'tasks', 'create', '--file', manifest, '--not-a-flag');
  assert.equal(rejected.code, 2);
  assert.equal(rejected.json.error.code, 'INVALID_ARGUMENT');
  assert.equal(rejected.stderr, '');
  const missing = await run(root, 'tasks', 'get', 'unknown');
  assert.equal(missing.code, 2);
  assert.equal(missing.json.error.code, 'NOT_FOUND');
  // A CLI deadline stops waiting, without cancelling the daemon-owned job.
  const unlock = runtime.service.locks.acquire('douyin:test-account', 'test-login');
  const pending = await run(root, 'tasks', 'create', '--file', manifest, '--idempotency-key', 'wait-timeout');
  const pendingId = pending.json.data.task.id;
  const timeout = await run(root, 'tasks', 'wait', pendingId, '--timeout', '0.1');
  assert.equal(timeout.code, 3, timeout.stdout);
  assert.equal(runtime.service.get(pendingId).status, 'queued');
  await run(root, 'tasks', 'cancel', pendingId);
  unlock();
});

test('CLI 后台服务独立于命令生命周期，同一目录启动复用同一实例并可停止', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fabu-daemon-'));
  t.after(async () => {
    const instance = await discoverService(root);
    if (instance) await run(root, 'service', 'stop');
    fs.rmSync(root, { recursive: true, force: true });
  });
  const started = await run(root, 'service', 'start', '--port', '0');
  assert.equal(started.code, 0, started.stdout || started.stderr);
  assert.equal('token' in started.json.data, false);
  const status = await run(root, 'service', 'status');
  assert.equal(status.json.data.running, true);
  assert.equal(status.json.data.instance.pid, started.json.data.pid);
  const repeated = await run(root, 'service', 'start');
  assert.equal(repeated.json.data.reused, true);
  assert.equal(repeated.json.data.pid, started.json.data.pid);
  const instance = await discoverService(root);
  const capabilities = await requestService(instance, '/capabilities');
  assert.equal(capabilities.platforms.xiaohongshu.video.submit, false);
  const mode = fs.statSync(path.join(root, '.fabu', 'instance.json')).mode & 0o777;
  if (process.platform !== 'win32') assert.equal(mode, 0o600);
  const stop = await run(root, 'service', 'stop');
  assert.equal(stop.code, 0, stop.stdout);
  assert.equal((await run(root, 'service', 'status')).json.data.running, false);
});
