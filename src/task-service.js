import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { AppError } from './errors.js';
import { parseTask, normalizeTargets } from './task-schema.js';
import { inspectUploads, stageAssets } from './media.js';
import { TaskStore } from './task-store.js';
import { AccountLocks } from './account-locks.js';
import { SharedChromeRunner } from './runner.js';
import { ImageTextChromeRunner } from './image-text-runner.js';
import { PLATFORMS } from './platforms.js';

const now = () => new Date().toISOString();
const keyOf = job => `${job.platformKey}:${job.accountId}`;
const terminal = item => ['ready', 'failed', 'cancelled', 'interrupted'].includes(item.status);
const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, sorted(value[k])])) : value;

function fingerprint(input, assets) {
  const media = JSON.parse(JSON.stringify(input.media));
  const hash = ref => assets.find(a => a.ref === ref).sha256;
  if (media.video) media.video = hash(media.video);
  if (media.images) media.images = media.images.map(hash);
  for (const ratio of Object.keys(media.covers)) media.covers[ratio] = hash(media.covers[ratio]);
  const { idempotency_key: _key, ...rest } = input;
  return crypto.createHash('sha256').update(JSON.stringify(sorted({ ...rest, media }))).digest('hex');
}

export class TaskService {
  constructor({ dataRoot, accounts, store = new TaskStore(dataRoot), locks = new AccountLocks(), probe, maxConcurrency = 2, maxWindows = 8, runnerFactory } = {}) {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || !Number.isInteger(maxWindows) || maxWindows < maxConcurrency) throw new AppError('INVALID_CONFIG', '并发数必须为正整数，窗口上限不能小于并发数');
    Object.assign(this, { dataRoot, accounts, store, locks, probe, maxConcurrency, maxWindows });
    this.runnerFactory = runnerFactory || ((type, ...callbacks) => new (type === 'video' ? SharedChromeRunner : ImageTextChromeRunner)(...callbacks));
    this.live = new Map();
    this.queue = [];
    this.stopping = false;
    this.locks.onRelease = () => queueMicrotask(() => this.drain());
    this.recover();
  }

  recover() {
    for (const task of this.store.all()) {
      let changed = false;
      for (const item of task.items) {
        if (!terminal(item) || item.window_available) {
          changed = true;
          item.window_available = false;
          if (!terminal(item) || item.outcome === 'prepared') {
            item.status = 'interrupted';
            item.outcome = item.submission_started ? 'submission_unknown' : 'interrupted';
            item.error_code = item.submission_started ? 'SUBMISSION_UNKNOWN' : 'SERVICE_INTERRUPTED';
            item.message = item.submission_started ? '服务中断，可能已提交，请先到平台核实，禁止自动重试' : '服务已重启，原窗口不可恢复，可以明确重试此账号';
            item.retryable = !item.submission_started;
          }
        }
      }
      if (changed) { task.status = 'interrupted'; this.save(task, { type: 'interrupted', message: '服务恢复，未自动重放任务' }); }
    }
  }

  summarize(task) {
    task.finished = task.items.filter(terminal).length;
    task.failed = task.items.filter(i => terminal(i) && i.status !== 'ready').length;
    task.results = task.items.filter(terminal).map(i => ({
      platform_key: i.platform_key, platform: i.platform, account_id: i.account_id, account: i.account, avatar: i.avatar,
      success: i.status === 'ready', outcome: i.outcome, message: i.message, error_code: i.error_code || '', retryable: Boolean(i.retryable),
      attempt: i.attempt, window_available: Boolean(i.window_available), evidence: i.evidence || null, artifacts: i.artifacts || []
    }));
    task.issues = task.results.filter(r => !r.success).map(r => ({ platform: `${r.platform} · ${r.account}`, message: r.message }));
    if (task.finished === task.total && !['cancelled', 'interrupted'].includes(task.status)) task.status = 'completed';
    const outcomes = new Set(task.items.map(i => i.outcome).filter(Boolean));
    task.outcome = outcomes.size === 1 ? [...outcomes][0] : 'mixed';
    task.execution_status = task.finished < task.total ? task.status : task.items.some(i => i.outcome === 'submission_unknown') ? 'needs_attention' : task.failed === task.total ? task.status === 'cancelled' ? 'cancelled' : 'failed' : task.failed ? 'partial_failed' : 'succeeded';
    task.next_actions = task.items.flatMap(i => i.outcome === 'submission_unknown'
      ? [{ platform: i.platform_key, account_id: i.account_id, action: 'verify_submission', command: 'tasks reconcile', message: '先在平台核实提交结果，再记录 submitted 或 not_submitted' }]
      : i.outcome === 'prepared' && i.window_available ? [{ platform: i.platform_key, account_id: i.account_id, action: 'review_in_browser', message: '资料已准备，请在保留的 Chrome 窗口检查并发布' }]
      : i.error_code === 'LOGIN_EXPIRED' ? [{ platform: i.platform_key, account_id: i.account_id, action: 'login', command: 'accounts login' }] : []);
    if (task.finished === task.total) task.message = task.execution_status === 'needs_attention' ? '存在提交结果未知的账号，请先核实平台结果' : task.failed ? `处理结束，${task.failed} 个账号未完成` : task.outcome === 'submitted' ? '平台已确认接受提交；审核和公开发布状态以平台为准' : task.outcome === 'prepared' ? '资料准备完成，等待人工检查并发布' : '处理完成，请查看各账号结果';
    task.updated_at = now();
    return task;
  }

  save(task, event) { this.summarize(task); this.store.persist(task, event); }
  get(id) { const task = this.store.get(id); if (!task) throw new AppError('NOT_FOUND', '任务不存在', { status: 404 }); return task; }
  list(options) { return this.store.list(options); }
  events(id, after, limit) { this.get(id); return this.store.events(id, after, limit); }

  async prepare(raw, uploads) {
    const input = parseTask(raw);
    // Fast account/capability validation precedes expensive media inspection.
    if (!this.store.byKey(input.idempotency_key)) normalizeTargets(input, this.accounts);
    const assets = await inspectUploads(input, uploads, this.probe);
    const digest = fingerprint(input, assets);
    const existing = this.store.byKey(input.idempotency_key);
    if (existing) {
      if (existing.fingerprint !== digest) throw new AppError('IDEMPOTENCY_CONFLICT', '此幂等键已用于不同的任务内容', { status: 409 });
      return { existing: this.get(existing.id), digest, input, assets };
    }
    const video = assets.find(a => a.kind === 'video');
    const dimensions = { width: video?.width || 0, height: video?.height || 0 };
    const jobs = normalizeTargets(input, this.accounts, dimensions);
    return { input, assets, digest, jobs, dimensions };
  }

  async validate(raw, uploads) {
    const prepared = await this.prepare(raw, uploads);
    return { valid: true, existing_task_id: prepared.existing?.id || null, input: prepared.input,
      media: prepared.assets.map(({ path: _path, ...asset }) => asset),
      targets: prepared.jobs?.map(job => ({ platform: job.platformKey, account_id: job.accountId, title: job.title, declaration: job.declaration, action: job.action, scheduled_at: job.scheduledAt ? `${job.scheduledAt}:00+08:00` : null, use_custom_cover: job.useCustomCover })) || [],
      warnings: ['账号状态来自本地保存的登录态，实际有效性会在打开平台时验证', '准备模式保留 Chrome 窗口供人工检查；预约时间只会填写到平台表单'] };
  }

  async create(raw, uploads) {
    if (this.stopping) throw new AppError('SERVICE_STOPPING', '服务正在停止', { status: 503, retryable: true });
    const prepared = await this.prepare(raw, uploads);
    if (this.stopping) throw new AppError('SERVICE_STOPPING', '服务正在停止，请稍后用原幂等键重试', { status: 503, retryable: true });
    if (prepared.existing) return { task: prepared.existing, reused: true };
    // Fast reuse before staging. The key is checked again after asynchronous file copies.
    const existing = this.store.byKey(prepared.input.idempotency_key);
    if (existing) {
      if (existing.fingerprint !== prepared.digest) throw new AppError('IDEMPOTENCY_CONFLICT', '此幂等键已用于不同的任务内容', { status: 409 });
      return { task: this.get(existing.id), reused: true };
    }
    const id = crypto.randomUUID().replaceAll('-', '');
    const folder = path.join(this.dataRoot, 'task_files', 'managed', id);
    try {
      const assets = await stageAssets(prepared.assets, folder);
      if (this.stopping) throw new AppError('SERVICE_STOPPING', '服务正在停止，请稍后用原幂等键重试', { status: 503, retryable: true });
      const concurrent = this.store.byKey(prepared.input.idempotency_key);
      if (concurrent) {
        if (concurrent.fingerprint !== prepared.digest) throw new AppError('IDEMPOTENCY_CONFLICT', '此幂等键已用于不同的任务内容', { status: 409 });
        fs.rmSync(folder, { recursive: true, force: true });
        return { task: this.get(concurrent.id), reused: true };
      }
      const video = assets.find(a => a.kind === 'video');
      const covers = Object.fromEntries(assets.filter(a => a.kind === 'cover').map(a => [a.ratio, a.path]));
      const jobs = prepared.jobs.map(job => ({ ...job, video: video?.path, images: assets.filter(a => a.kind === 'image').map(a => a.path), covers }));
      const task = {
        schema_version: 1, id, type: prepared.input.type, status: 'queued', total: jobs.length, finished: 0, failed: 0, issues: [], results: [],
        message: '任务已入队', created_at: now(), updated_at: now(),
        items: jobs.map(job => ({ platform_key: job.platformKey, platform: PLATFORMS[job.platformKey].name, account_id: job.accountId, account: job.account, avatar: job.avatar, action: job.action, status: 'queued', outcome: null, message: '等待可用执行窗口', attempt: 1, updated_at: now(), window_available: false, artifacts: [] })),
        cover_details: Object.fromEntries(assets.filter(a => a.kind === 'cover').map(a => [a.ratio, { filename: a.filename, bytes: a.bytes, original: true }])),
        video_dimensions: prepared.dimensions, image_count: assets.filter(a => a.kind === 'image').length,
        image_details: assets.filter(a => a.kind === 'image').map((a, i) => ({ order: i + 1, filename: a.filename, bytes: a.bytes })),
        targets: jobs.map(j => ({ platform_key: j.platformKey, account_id: j.accountId })), titles: Object.fromEntries(jobs.map(j => [j.platformKey, j.title])),
        declarations: Object.fromEntries(jobs.map(j => [j.platformKey, j.declaration])), topics: jobs[0].topics, location: jobs[0].location,
        channels_short_title: jobs.find(j => j.platformKey === 'channels')?.shortTitle || '',
        original: jobs.some(j => j.original), channels_original: jobs.some(j => j.channelsOriginal), channels_hide_location: jobs.some(j => j.channelsHideLocation),
        schedule_enabled: jobs.some(j => j.scheduledAt), scheduled_at: jobs.find(j => j.scheduledAt)?.scheduledAt || '',
        scheduled_at_by_platform: Object.fromEntries(jobs.map(j => [j.platformKey, j.scheduledAt])),
        direct_publish_by_platform: Object.fromEntries(jobs.map(j => [j.platformKey, j.directPublish]))
      };
      this.summarize(task);
      this.store.insert(task, { input: prepared.input, jobs, assets }, prepared.digest, prepared.input.idempotency_key);
      jobs.forEach((job, index) => this.queue.push({ id, index, job, attempt: 1 }));
      queueMicrotask(() => this.drain());
      return { task, reused: false };
    } catch (error) { fs.rmSync(folder, { recursive: true, force: true }); throw error; }
  }

  drain() {
    if (this.stopping) return;
    while ([...this.live.values()].filter(e => e.running).length < this.maxConcurrency && this.live.size < this.maxWindows) {
      const index = this.queue.findIndex(entry => !this.locks.busy(keyOf(entry.job)));
      if (index < 0) break;
      const entry = this.queue.splice(index, 1)[0];
      const task = this.get(entry.id);
      if (task.items[entry.index].status !== 'queued') continue;
      this.launch(entry);
    }
  }

  launch(entry) {
    const liveKey = `${entry.id}:${entry.index}`;
    entry.release = this.locks.acquire(keyOf(entry.job), liveKey);
    entry.running = true;
    entry.job = { ...entry.job, artifactDir: path.join(this.dataRoot, 'task_files', 'managed', entry.id, 'artifacts', `${entry.job.platformKey}_${entry.job.accountId}`, `attempt_${entry.attempt}`) };
    fs.mkdirSync(entry.job.artifactDir, { recursive: true });
    const update = (callback, event) => {
      if (this.stopping) return;
      const task = this.get(entry.id);
      const item = task.items[entry.index];
      if (item.attempt !== entry.attempt || terminal(item)) return;
      callback(task, item);
      item.updated_at = now();
      this.save(task, { ...event, account_id: item.account_id, platform: item.platform_key, attempt: item.attempt });
    };
    const runner = this.runnerFactory(this.get(entry.id).type,
      message => update((task, item) => { task.message = message; item.message = message; }, { type: 'log', message }),
      (_job, success, message = '', code = '', result = {}) => update((_task, item) => {
        Object.assign(item, { status: success ? 'ready' : 'failed', outcome: result.outcome || (item.submission_started ? 'submission_unknown' : success ? 'prepared' : 'failed'),
          error_code: code || (success ? '' : item.submission_started ? 'SUBMISSION_UNKNOWN' : 'AUTOMATION_FAILED'),
          message: message || (result.outcome === 'submitted' ? '平台已确认接受提交' : success ? '资料填写完成，等待人工检查并发布' : '平台自动化未完成'),
          retryable: !success && !item.submission_started, evidence: result.evidence || null, window_available: Boolean(runner.hasOpenWindows?.()) });
      }, { type: 'result', success, message, result }),
      (_job, status, message) => update((task, item) => {
        task.status = 'running';
        item.status = status === 'ready' || status === 'failed' || status === 'cancelled' ? 'finalizing' : status;
        item.message = message;
        if (status === 'submitting') item.submission_started = true;
        item.window_available = Boolean(runner.hasOpenWindows?.());
      }, { type: 'stage', stage: status, message })
    );
    entry.runner = runner;
    runner.onWindowClosed = () => {
      if (!entry.running) this.releaseEntry(liveKey, entry);
    };
    this.live.set(liveKey, entry);
    update((task, item) => { task.status = 'running'; item.status = 'launching'; }, { type: 'started' });
    entry.promise = Promise.resolve().then(() => {
      const plan = this.store.plan(entry.id);
      normalizeTargets({ ...plan.input, targets: [plan.input.targets[entry.index]] }, this.accounts, this.get(entry.id).video_dimensions);
      return runner.run(entry.job);
    }).catch(error => {
      update((_task, item) => Object.assign(item, { status: 'failed', outcome: item.submission_started ? 'submission_unknown' : 'failed', error_code: item.submission_started ? 'SUBMISSION_UNKNOWN' : error.code || 'AUTOMATION_FAILED', message: error.message, retryable: !item.submission_started }), { type: 'error', message: error.message });
    }).finally(() => {
      entry.running = false;
      if (!this.stopping) {
        const task = this.get(entry.id);
        const item = task.items[entry.index];
        if (!terminal(item)) Object.assign(item, { status: 'failed', outcome: item.submission_started ? 'submission_unknown' : 'failed', error_code: 'AUTOMATION_FAILED', message: '执行器结束但没有返回结果', retryable: !item.submission_started });
        item.artifacts = [...new Set([...(item.artifacts || []), ...fs.readdirSync(entry.job.artifactDir).map(name => path.relative(path.join(this.dataRoot, 'task_files', 'managed', entry.id), path.join(entry.job.artifactDir, name)).split(path.sep).join('/'))])];
        item.window_available = Boolean(runner.hasOpenWindows?.());
        this.save(task, { type: 'artifacts', account_id: item.account_id, paths: item.artifacts });
      }
      if (!runner.hasOpenWindows?.()) this.releaseEntry(liveKey, entry);
      else this.drain();
    });
  }

  releaseEntry(key, entry) {
    if (this.live.get(key) !== entry) return;
    this.live.delete(key);
    entry.release();
    if (!this.stopping) {
      const task = this.get(entry.id);
      task.items[entry.index].window_available = false;
      this.save(task, { type: 'window_closed', account_id: entry.job.accountId });
      this.drain();
    }
  }

  async closeWindows(id) {
    this.get(id);
    if ([...this.live.values()].some(e => e.id === id && e.running)) throw new AppError('TASK_RUNNING', '任务仍在运行，请使用 cancel 取消', { status: 409 });
    await Promise.all([...this.live.entries()].filter(([, e]) => e.id === id).map(async ([key, entry]) => { await entry.runner.closeWindows(); this.releaseEntry(key, entry); }));
    return this.get(id);
  }

  async cancel(id) {
    const task = this.get(id);
    if (task.finished === task.total) return task;
    task.status = 'cancelled';
    for (const item of task.items.filter(i => !terminal(i))) Object.assign(item, { status: 'cancelled', outcome: item.submission_started ? 'submission_unknown' : 'cancelled', error_code: item.submission_started ? 'SUBMISSION_UNKNOWN' : 'CANCELLED', message: item.submission_started ? '取消时可能已提交，请先核实平台结果' : '任务已取消', retryable: !item.submission_started });
    this.save(task, { type: 'cancelled' });
    this.queue = this.queue.filter(e => e.id !== id);
    await Promise.all([...this.live.values()].filter(e => e.id === id).map(e => e.runner.cancel()));
    this.drain();
    return this.get(id);
  }

  async retry(id, { accountId, platform } = {}) {
    const task = this.get(id);
    if (task.finished !== task.total || [...this.live.values()].some(e => e.id === id && e.running)) throw new AppError('TASK_RUNNING', '任务仍在运行，暂时不能重试', { status: 409 });
    const candidates = task.items.map((item, index) => ({ item, index })).filter(({ item }) => item.status !== 'ready' && (!accountId || item.account_id === accountId) && (!platform || item.platform_key === platform));
    if (!candidates.length) throw new AppError('NOT_RETRYABLE', '当前没有可重试的失败账号');
    if (candidates.some(({ item }) => item.outcome === 'submission_unknown')) throw new AppError('SUBMISSION_UNKNOWN', '提交结果未知，必须先到平台核实并通过 reconcile 记录结果，不能自动重试', { status: 409 });
    const plan = this.store.plan(id);
    // Revalidate account and schedule because either may have expired while queued.
    const validated = new Map(candidates.map(({ index }) => [index, normalizeTargets({ ...plan.input, targets: [plan.input.targets[index]] }, this.accounts, task.video_dimensions)[0]]));
    for (const asset of plan.assets) if (!fs.existsSync(asset.path)) throw new AppError('MISSING_ASSET', '原任务素材已丢失，无法重试');
    for (const { index } of candidates) {
      const entry = this.live.get(`${id}:${index}`);
      if (entry) { await entry.runner.closeWindows(); this.releaseEntry(`${id}:${index}`, entry); }
    }
    const current = this.get(id);
    current.status = 'queued';
    for (const { index } of candidates) {
      const item = current.items[index];
      Object.assign(item, { status: 'queued', outcome: null, error_code: '', message: '等待重新执行', retryable: false, submission_started: false, evidence: null, window_available: false, attempt: item.attempt + 1 });
      this.queue.push({ id, index, attempt: item.attempt, job: { ...plan.jobs[index], ...validated.get(index) } });
    }
    this.save(current, { type: 'retry', accounts: candidates.map(c => c.item.account_id) });
    this.drain();
    return this.get(id);
  }

  reconcile(id, { platform, account_id, result, note }) {
    const task = this.get(id);
    const item = task.items.find(i => i.platform_key === platform && i.account_id === account_id);
    if (!item || item.outcome !== 'submission_unknown' || !terminal(item)) throw new AppError('INVALID_RECONCILIATION', '仅能核实已结束且提交结果未知的账号');
    if (!['submitted', 'not_submitted'].includes(result) || !String(note || '').trim()) throw new AppError('INVALID_RECONCILIATION', '必须提供 submitted 或 not_submitted 及平台核实依据 note');
    Object.assign(item, { status: result === 'submitted' ? 'ready' : 'failed', outcome: result === 'submitted' ? 'submitted' : 'not_submitted', submission_started: result === 'submitted', retryable: result !== 'submitted', error_code: result === 'submitted' ? '' : 'NOT_SUBMITTED', message: `调用者已核实：${note}`, evidence: { source: 'caller_verification', note, verified_at: now() } });
    if (task.items.every(terminal)) task.status = 'completed';
    this.save(task, { type: 'reconciled', platform, account_id, result, note });
    return task;
  }

  async verify(id, { platform, account_id } = {}) {
    const task = this.get(id);
    const selected = task.items.map((item, index) => ({ item, index })).filter(({ item }) => item.outcome === 'submission_unknown' && terminal(item) && (!platform || item.platform_key === platform) && (!account_id || item.account_id === account_id));
    if (!selected.length) throw new AppError('INVALID_RECONCILIATION', '当前没有已结束且提交结果未知的账号');
    for (const { index } of selected) {
      const entry = this.live.get(`${id}:${index}`);
      if (!entry || entry.running || !entry.runner.verifySubmission) throw new AppError('SUBMISSION_UNKNOWN', '原任务窗口不可用，请到平台核实并使用 reconcile 记录结果', { status: 409 });
      const result = await entry.runner.verifySubmission(entry.job);
      const current = this.get(id);
      const item = current.items[index];
      if (item.outcome !== 'submission_unknown') continue;
      Object.assign(item, { status: 'ready', outcome: result.outcome, error_code: '', retryable: false, evidence: result.evidence, message: '已重新检测到平台接受提交的回执' });
      if (current.items.every(terminal)) current.status = 'completed';
      this.save(current, { type: 'submission_verified', platform: item.platform_key, account_id: item.account_id, evidence: result.evidence });
      if (entry.job.closeAfterSubmit) { await entry.runner.closeWindows(); this.releaseEntry(`${id}:${index}`, entry); }
    }
    return this.get(id);
  }

  artifact(id, relative) {
    const task = this.get(id);
    if (!task.items.some(i => i.artifacts?.includes(relative))) throw new AppError('NOT_FOUND', '附件不存在', { status: 404 });
    return path.join(this.dataRoot, 'task_files', 'managed', id, relative);
  }

  async shutdown() {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.stopping = true;
    this.queue = [];
    this.shutdownPromise = (async () => {
      // Persist interruption before closing pages so a click in flight remains uncertain.
      for (const task of this.store.all()) {
        let changed = false;
        for (const item of task.items) {
          if (!terminal(item) || item.window_available && item.outcome === 'prepared') {
            changed = true;
            Object.assign(item, { status: 'interrupted', outcome: item.submission_started ? 'submission_unknown' : 'interrupted', error_code: item.submission_started ? 'SUBMISSION_UNKNOWN' : 'SERVICE_INTERRUPTED', message: item.submission_started ? '服务停止时可能已提交，请先核实' : '服务停止，原窗口已关闭，可明确重试', retryable: !item.submission_started });
          }
          item.window_available = false;
        }
        if (changed) { task.status = 'interrupted'; this.save(task, { type: 'interrupted', message: '服务停止' }); }
        else this.store.persist(task);
      }
      await Promise.allSettled([...this.live.values()].map(e => e.runner.cancel()));
      await Promise.allSettled([...this.live.values()].map(e => e.promise));
      for (const e of this.live.values()) e.release();
      this.live.clear();
      this.store.close();
    })();
    return this.shutdownPromise;
  }
}
