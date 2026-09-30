import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { TaskService } from '../src/task-service.js';
import { AccountLocks } from '../src/account-locks.js';
import { parseTask, normalizeTargets, normalizeSchedule } from '../src/task-schema.js';
import { probeMedia } from '../src/media.js';

const accounts = { getAccount: (platform, id) => id.startsWith('missing') ? null : ({ id, nickname: id, platform_key: platform }) };
const fakeProbe = async () => ({ width: 1920, height: 1080, duration: 1, codec: 'h264', format: 'mov,mp4,m4a,3gp,3g2,mj2' });
const inputFor = (key = 'one', targets = [{ platform: 'douyin', account_id: 'a' }]) => ({ schema_version: 1, type: 'video', idempotency_key: key, action: 'prepare', media: { video: 'video:0' }, content: { title: '测试视频' }, targets });
async function until(predicate) { for (let i = 0; i < 200; i++) { if (predicate()) return; await delay(10); } assert.fail('等待条件超时'); }

function harness(t, { behavior, ...options } = {}) {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fabu-core-'));
  const video = path.join(dataRoot, 'input.mp4');
  fs.writeFileSync(video, 'fixture video');
  const h = { dataRoot, starts: [], uploads: { 'video:0': { path: video, originalname: 'test.mp4' } } };
  h.factory = (_type, log, completed, progress) => {
    const runner = {
      open: false,
      hasOpenWindows() { return this.open; },
      async closeWindows() { this.open = false; this.onWindowClosed?.(); },
      async cancel() { await this.closeWindows(); this.resolve?.(); },
      async run(job) {
        this.open = true;
        h.starts.push(job);
        progress(job, 'uploading', '正在上传');
        if (behavior) await behavior({ runner: this, job, log, completed, progress });
        else { progress(job, 'ready', '完成'); completed(job, true, '', '', { outcome: 'prepared' }); await this.closeWindows(); }
      }
    };
    return runner;
  };
  h.service = new TaskService({ dataRoot, accounts, probe: fakeProbe, runnerFactory: h.factory, ...options });
  t.after(async () => { await h.service.shutdown(); fs.rmSync(dataRoot, { recursive: true, force: true }); });
  return h;
}

test('共享 Schema 拒绝未知参数，默认字段完整，平台能力不能静默降级', () => {
  const input = parseTask(inputFor());
  assert.deepEqual(input.content.topics, []);
  assert.throws(() => parseTask({ ...inputFor(), mistyped: true }), { code: 'INVALID_INPUT' });
  assert.throws(() => normalizeTargets(parseTask({ ...inputFor(), action: 'submit', targets: [{ platform: 'xiaohongshu', account_id: 'a' }] }), accounts), { code: 'UNSUPPORTED_CAPABILITY' });
  assert.throws(() => normalizeTargets(parseTask(inputFor('one', [{ platform: 'douyin', account_id: 'missing' }])), accounts), { code: 'LOGIN_EXPIRED' });
});

test('时间规则按平台执行并明确转换为中国时区，不依赖主机时区', () => {
  const now = Date.parse('2026-09-05T00:00:00Z');
  assert.throws(() => normalizeSchedule('2026-09-05T09:00:00+08:00', 'douyin', now), { code: 'INVALID_SCHEDULE' });
  assert.equal(normalizeSchedule('2026-09-05T02:05:00Z', 'douyin', now), '2026-09-05T10:05');
  assert.throws(() => normalizeSchedule('2026-09-05T10:05', 'douyin', now), { code: 'INVALID_SCHEDULE' });
  assert.throws(() => normalizeSchedule('2026-09-05T10:03:00+08:00', 'bilibili', now), { code: 'INVALID_SCHEDULE' });
});

test('validate 不启动浏览器、不创建任务，create 对并发重试只创建和执行一次', async t => {
  const h = harness(t);
  const validation = await h.service.validate(inputFor(), h.uploads);
  assert.equal(validation.valid, true);
  assert.equal(h.service.list().length, 0);
  assert.equal(h.starts.length, 0);
  const created = await Promise.all([h.service.create(inputFor(), h.uploads), h.service.create(inputFor(), h.uploads)]);
  assert.equal(created[0].task.id, created[1].task.id);
  assert.equal(created.filter(r => r.reused).length, 1);
  await until(() => h.service.get(created[0].task.id).status === 'completed');
  assert.equal(h.starts.length, 1);
  assert.equal(h.service.get(created[0].task.id).outcome, 'prepared');
  assert.equal(h.service.get(created[0].task.id).execution_status, 'succeeded');
  assert.equal(h.service.get(created[0].task.id).results[0].success, true);
  assert.throws(() => h.service.locks.acquire('x', 'y') && h.service.locks.acquire('x', 'z'), { code: 'ACCOUNT_BUSY' });
});

test('同一个幂等键的媒体内容或标题变化返回冲突', async t => {
  const h = harness(t);
  await h.service.create(inputFor(), h.uploads);
  await assert.rejects(h.service.create({ ...inputFor(), content: { title: '不同标题' } }, h.uploads), { code: 'IDEMPOTENCY_CONFLICT' });
  fs.writeFileSync(h.uploads['video:0'].path, 'changed media');
  await assert.rejects(h.service.create(inputFor(), h.uploads), { code: 'IDEMPOTENCY_CONFLICT' });
});

test('同账号跨任务互斥，准备窗口保留时占用账号与窗口容量', async t => {
  const h = harness(t, { maxConcurrency: 1, maxWindows: 1, behavior: async ({ job, completed }) => { completed(job, true, '', '', { outcome: 'prepared' }); } });
  const first = await h.service.create(inputFor('first'), h.uploads);
  await until(() => h.service.get(first.task.id).status === 'completed');
  const second = await h.service.create(inputFor('second'), h.uploads);
  await delay(20);
  assert.equal(h.starts.length, 1);
  assert.equal(h.service.get(second.task.id).status, 'queued');
  assert.equal(h.service.locks.busy('douyin:a'), true);
  await h.service.closeWindows(first.task.id);
  await until(() => h.starts.length === 2);
  assert.equal(h.service.get(first.task.id).items[0].window_available, false);
});

test('部分失败单独重试，已成功的账号不会被重放', async t => {
  let fail = true;
  const h = harness(t, { behavior: async ({ runner, job, completed, progress }) => {
    const success = job.accountId === 'a' || !fail;
    progress(job, success ? 'ready' : 'failed', '执行结果');
    completed(job, success, success ? '' : '暂时失败', success ? '' : 'AUTOMATION_FAILED');
    await runner.closeWindows();
  } });
  const { task } = await h.service.create(inputFor('partial', [{ platform: 'douyin', account_id: 'a' }, { platform: 'douyin', account_id: 'b' }]), h.uploads);
  await until(() => h.service.get(task.id).status === 'completed' && h.service.live.size === 0);
  assert.equal(h.service.get(task.id).execution_status, 'partial_failed');
  fail = false;
  await h.service.retry(task.id);
  await until(() => h.service.get(task.id).status === 'completed');
  assert.deepEqual(h.starts.map(j => j.accountId), ['a', 'b', 'b']);
  assert.equal(h.service.get(task.id).items[1].attempt, 2);
});

test('在提交边界停止服务后持久化 unknown，重启不重放，必须核实后才能重试', async t => {
  const h = harness(t, { behavior: async ({ runner, job, progress }) => { progress(job, 'submitting', '点击前落盘'); await new Promise(resolve => { runner.resolve = resolve; }); } });
  const input = { ...inputFor('submit'), action: 'submit' };
  const { task } = await h.service.create(input, h.uploads);
  await until(() => h.service.get(task.id).items[0].submission_started);
  await h.service.shutdown();
  h.service = new TaskService({ dataRoot: h.dataRoot, accounts, probe: fakeProbe, runnerFactory: h.factory });
  assert.equal(h.service.get(task.id).outcome, 'submission_unknown');
  assert.ok(Date.parse(h.service.get(task.id).items[0].submission_started_at));
  assert.equal(h.service.get(task.id).execution_status, 'needs_attention');
  assert.equal(h.starts.length, 1);
  assert.equal((await h.service.create(input, h.uploads)).reused, true);
  await assert.rejects(h.service.retry(task.id), { code: 'SUBMISSION_UNKNOWN' });
  const resolved = h.service.reconcile(task.id, { platform: 'douyin', account_id: 'a', result: 'not_submitted', note: '检查平台作品列表和草稿，确认未产生本次投稿' });
  assert.equal(resolved.items[0].retryable, true);
  assert.equal(resolved.items[0].submission_started, false);
  assert.equal(h.service.events(task.id).some(e => e.type === 'reconciled'), true);
});

test('取消队列任务不打开浏览器，关闭运行中窗口要求显式取消', async t => {
  const locks = new AccountLocks();
  const unlock = locks.acquire('douyin:a', 'binding');
  const h = harness(t, { locks });
  const { task } = await h.service.create(inputFor(), h.uploads);
  await h.service.cancel(task.id);
  unlock();
  await delay(20);
  assert.equal(h.starts.length, 0);
  assert.equal(h.service.get(task.id).status, 'cancelled');
});

test('未知提交可在保留窗口重新读取回执，不会再次执行发布', async t => {
  const h = harness(t, { behavior: async ({ runner, job, completed, progress }) => {
    runner.verifySubmission = async () => ({ outcome: 'submitted', evidence: { source: 'platform_receipt', text: '发布成功' } });
    progress(job, 'submitting', '即将点击');
    completed(job, false, '尚未检测到回执', 'SUBMISSION_UNKNOWN', { outcome: 'submission_unknown' });
  } });
  const { task } = await h.service.create({ ...inputFor('verify'), action: 'submit' }, h.uploads);
  await until(() => h.service.get(task.id).status === 'completed' && [...h.service.live.values()].every(e => !e.running));
  assert.equal(h.service.get(task.id).outcome, 'submission_unknown');
  const verified = await h.service.verify(task.id);
  assert.equal(verified.outcome, 'submitted');
  assert.equal(verified.execution_status, 'succeeded');
  assert.equal(verified.results[0].evidence.source, 'platform_receipt');
  assert.equal(h.starts.length, 1);
  assert.equal(h.service.live.size, 0);
});

test('重新核验失败会记录事件并保留 unknown，不能触发重发', async t => {
  const h = harness(t, { behavior: async ({ runner, job, completed, progress }) => {
    runner.verifySubmission = async () => { throw Object.assign(new Error('列表记录仍未匹配'), { code: 'SUBMISSION_UNKNOWN' }); };
    progress(job, 'submitting', '即将点击');
    completed(job, false, '尚未检测到回执', 'SUBMISSION_UNKNOWN', { outcome: 'submission_unknown' });
  } });
  const { task } = await h.service.create({ ...inputFor('verify-failure'), action: 'submit' }, h.uploads);
  await until(() => h.service.get(task.id).status === 'completed' && [...h.service.live.values()].every(e => !e.running));
  await assert.rejects(h.service.verify(task.id), { code: 'SUBMISSION_UNKNOWN' });
  assert.equal(h.service.get(task.id).outcome, 'submission_unknown');
  assert.equal(h.starts.length, 1);
  const events = h.service.events(task.id, 0, 100);
  assert.ok(events.some(event => event.type === 'submission_verification_failed' && event.code === 'SUBMISSION_UNKNOWN'));
});

test('取消正在提交的任务保留 unknown，迟到的完成回调不能覆盖取消结果', async t => {
  const h = harness(t, { behavior: async ({ runner, job, completed, progress }) => {
    progress(job, 'submitting', '提交边界');
    await new Promise(resolve => { runner.resolve = resolve; });
    completed(job, true, '迟到的回调', '', { outcome: 'submitted' });
  } });
  const { task } = await h.service.create({ ...inputFor('cancel-submit'), action: 'submit' }, h.uploads);
  await until(() => h.service.get(task.id).items[0].submission_started);
  await assert.rejects(h.service.closeWindows(task.id), { code: 'TASK_RUNNING' });
  await h.service.cancel(task.id);
  await until(() => h.service.live.size === 0);
  assert.equal(h.service.get(task.id).outcome, 'submission_unknown');
  await assert.rejects(h.service.retry(task.id), { code: 'SUBMISSION_UNKNOWN' });
});

test('截图按平台、账号与尝试隔离，并保留事件分页顺序', async t => {
  const h = harness(t, { behavior: async ({ runner, job, completed }) => {
    fs.writeFileSync(path.join(job.artifactDir, 'ready.html'), job.accountId);
    completed(job, true);
    await runner.closeWindows();
  } });
  const { task } = await h.service.create(inputFor('artifacts', [{ platform: 'douyin', account_id: 'a' }, { platform: 'douyin', account_id: 'b' }]), h.uploads);
  await until(() => h.service.get(task.id).items.every(i => i.artifacts.length));
  const result = h.service.get(task.id);
  assert.notEqual(result.items[0].artifacts[0], result.items[1].artifacts[0]);
  assert.equal(fs.readFileSync(h.service.artifact(task.id, result.items[0].artifacts[0]), 'utf8'), 'a');
  assert.throws(() => h.service.artifact(task.id, '../../account_data/bindings.json'), { code: 'NOT_FOUND' });
  const first = h.service.events(task.id, 0, 2);
  const rest = h.service.events(task.id, first.at(-1).seq);
  assert.ok(rest.every(e => e.seq > first.at(-1).seq));
});

test('真实 ffprobe 读取图片尺寸，并拒绝损坏素材', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'fabu-media-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const png = path.join(folder, 'pixel.png');
  fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jHZkAAAAASUVORK5CYII=', 'base64'));
  const media = await probeMedia(png);
  assert.equal(media.width, 1);
  assert.equal(media.height, 1);
  fs.writeFileSync(png, 'invalid');
  await assert.rejects(probeMedia(png), { code: 'INVALID_MEDIA' });
});
