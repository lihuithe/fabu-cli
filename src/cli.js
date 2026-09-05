import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { Command, InvalidArgumentError } from 'commander';
import { APP_VERSION } from './app-meta.js';
import { applicationDataRoot } from './runtime-paths.js';
import { AppError, errorBody } from './errors.js';
import { parseTask, taskJSONSchema } from './task-schema.js';
import { ffprobePath } from './media.js';
import { discoverService, requireService, requestService, startBackgroundService, publicInstance } from './service-client.js';

const number = value => {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw new InvalidArgumentError('必须是非负数');
  return result;
};
const integer = value => {
  const result = number(value);
  if (!Number.isInteger(result)) throw new InvalidArgumentError('必须是整数');
  return result;
};
const done = task => ['completed', 'cancelled', 'interrupted'].includes(task.status);
export function taskExitCode(task) {
  if (task.items?.some(i => i.outcome === 'submission_unknown' || i.error_code === 'LOGIN_EXPIRED')) return 5;
  if (task.failed > 0 && task.failed < task.total) return 4;
  if (task.status === 'cancelled') return 6;
  if (task.failed || task.status === 'interrupted') return 1;
  return 0;
}
export function errorExitCode(error) {
  if (['WAIT_TIMEOUT', 'REQUEST_TIMEOUT'].includes(error.code)) return 3;
  if (['LOGIN_EXPIRED', 'SUBMISSION_UNKNOWN'].includes(error.code)) return 5;
  if (error.code?.startsWith('SERVICE_') || ['UNAUTHORIZED', 'FFPROBE_NOT_FOUND'].includes(error.code)) return 7;
  return (error.status || 400) < 500 ? 2 : 1;
}

export async function loadManifest(filename, { baseDir, idempotencyKey } = {}) {
  let content;
  if (filename === '-') {
    if (process.stdin.isTTY) throw new AppError('INVALID_INPUT', '请通过管道向标准输入传入 JSON');
    const chunks = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) throw new AppError('INVALID_INPUT', '任务 JSON 不能超过 1MB');
      chunks.push(chunk);
    }
    content = Buffer.concat(chunks).toString('utf8');
  } else {
    if (fs.statSync(filename).size > 1024 * 1024) throw new AppError('INVALID_INPUT', '任务 JSON 不能超过 1MB');
    content = fs.readFileSync(filename, 'utf8');
  }
  let input;
  try { input = JSON.parse(content); } catch { throw new AppError('INVALID_INPUT', '任务文件不是有效的 JSON'); }
  if (idempotencyKey) input.idempotency_key = idempotencyKey;
  input = parseTask(input);
  const root = path.resolve(baseDir || (filename === '-' ? process.cwd() : path.dirname(path.resolve(filename))));
  const form = new FormData();
  const add = async (name, filename, index = 0) => {
    const absolute = path.resolve(root, filename);
    const stat = fs.statSync(absolute);
    if (!stat.isFile()) throw new AppError('INVALID_MEDIA', `素材必须是普通文件：${absolute}`);
    // openAsBlob streams the underlying file instead of loading a large video into RAM.
    const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[path.extname(absolute).toLowerCase()] || 'application/octet-stream';
    form.append(name, await fs.openAsBlob(absolute, { type: mime }), path.basename(absolute));
    return `${name}:${index}`;
  };
  if (input.media.video) input.media.video = await add('video', input.media.video);
  if (input.media.images) {
    const ordered = [];
    for (const [index, file] of input.media.images.entries()) ordered.push(await add('images', file, index));
    input.media.images = ordered;
  }
  for (const [ratio, file] of Object.entries(input.media.covers)) input.media.covers[ratio] = await add(`cover_${ratio.replace(':', '_')}`, file);
  form.append('manifest', JSON.stringify(input));
  return { form, input };
}

export async function runCLI(argv = process.argv) {
  const program = new Command();
  program.name('fabu').description('面向 Agent 的本地多平台发布工具').version(APP_VERSION)
    .option('--json', '只在 stdout 输出结构化 JSON')
    .option('--data-dir <path>', '账号、任务和本地服务数据目录', applicationDataRoot(import.meta.url, 1))
    .showHelpAfterError().exitOverride();
  // Commander parse errors are rendered by the same JSON error handler as business errors.
  program.configureOutput({ writeErr: () => {} });
  const settings = () => program.opts();
  const root = () => path.resolve(settings().dataDir);
  const output = (data, exitCode = 0) => {
    process.stdout.write(JSON.stringify({ schema_version: 1, success: true, data }, null, settings().json ? 0 : 2) + '\n');
    process.exitCode = exitCode;
  };
  const request = async (route, options) => requestService(await requireService(root()), route, options);
  const progress = message => { if (!settings().json) process.stderr.write(`${message}\n`); };

  program.command('doctor').description('检查 Node、Chrome、ffprobe 和服务').action(async () => {
    process.env.PUBLISHER_DATA_ROOT = root();
    const { chromeCandidates } = await import('./account-binding.js');
    const chrome = chromeCandidates().find(p => fs.existsSync(p)) || null;
    let ffprobe = false;
    try { await promisify(execFile)(ffprobePath(), ['-version'], { timeout: 5000 }); ffprobe = true; } catch {}
    const instance = await discoverService(root());
    const ok = Boolean(chrome && ffprobe);
    output({ ok, node: process.version, chrome, ffprobe: { available: ffprobe, executable: ffprobePath() }, data_dir: root(), service: instance ? publicInstance(instance) : null, desktop_required: true, next_actions: [...(!chrome ? ['安装 Google Chrome'] : []), ...(!ffprobe ? ['安装 FFmpeg 或设置 FFPROBE_PATH'] : []), ...(!instance ? ['fabu service start'] : [])] }, ok ? 0 : 7);
  });
  const service = program.command('service').description('管理常驻本地服务');
  service.command('start').option('--port <number>', '首选端口；占用时自动尝试后续端口', integer).action(async options => { if (options.port > 65535) throw new AppError('INVALID_INPUT', '端口不能超过 65535'); output(await startBackgroundService(root(), options)); });
  service.command('status').action(async () => { const instance = await discoverService(root()); output({ running: Boolean(instance), instance: instance ? publicInstance(instance) : null }); });
  service.command('stop').action(async () => {
    const instance = await discoverService(root());
    if (!instance) return output({ stopped: true, already_stopped: true });
    await requestService(instance, '/service/stop', { method: 'POST' });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (!fs.existsSync(path.join(root(), '.fabu', 'instance.json'))) return output({ stopped: true });
      await delay(200);
    }
    throw new AppError('WAIT_TIMEOUT', '已请求停止服务，等待退出超时，请查询 service status');
  });
  program.command('capabilities').description('查询平台支持的内容类型、动作和限制').action(async () => output(await request('/capabilities')));
  program.command('schema <name>').description('输出输入 JSON Schema（无需启动服务）').action(name => { if (name !== 'task') throw new AppError('INVALID_INPUT', '仅支持 schema task'); output(taskJSONSchema()); });
  const accounts = program.command('accounts').description('平台账号与登录');
  accounts.command('list').action(async () => output(await request('/accounts')));
  accounts.command('login').requiredOption('--platform <key>').option('--account-id <id>', '重新登录现有账号').option('--remark <text>', '账号备注').option('--wait', '等待登录完成').option('--timeout <seconds>', '等待秒数', number, 300).action(async options => {
    const result = await request(`/accounts/${encodeURIComponent(options.platform)}/login`, { method: 'POST', body: { account_id: options.accountId, remark: options.remark } });
    if (!options.wait) return output(result);
    progress(`请在 Chrome 中完成登录，登录任务 ${result.binding_id}`);
    const deadline = Date.now() + options.timeout * 1000;
    while (Date.now() < deadline) {
      const status = await request(`/bindings/${encodeURIComponent(result.binding_id)}`);
      if (!status.is_running) return output(status, status.status === 'completed' ? 0 : 5);
      await delay(500);
    }
    throw new AppError('WAIT_TIMEOUT', '等待登录超时，登录窗口可能仍在等待操作', { details: { binding_id: result.binding_id } });
  });
  accounts.command('login-status <bindingId>').action(async id => output(await request(`/bindings/${encodeURIComponent(id)}`)));
  for (const verb of ['refresh', 'remove']) accounts.command(verb).requiredOption('--platform <key>').requiredOption('--account-id <id>').action(async options => output(await request(`/accounts/${encodeURIComponent(options.platform)}/${encodeURIComponent(options.accountId)}${verb === 'refresh' ? '/refresh-profile' : ''}`, { method: verb === 'refresh' ? 'POST' : 'DELETE' })));

  const tasks = program.command('tasks').description('创建、查询和恢复发布任务');
  for (const validate of [true, false]) tasks.command(validate ? 'validate' : 'create').requiredOption('--file <path>', 'JSON 文件，或 - 从 stdin 读取').option('--base-dir <path>', '素材相对路径的基准目录').option('--idempotency-key <key>', '重复调用标识；创建任务必须提供').option('--request-timeout <seconds>', '本地素材传输和请求超时', number, 900).action(async options => {
    const { form, input } = await loadManifest(options.file, options);
    if (!validate && !input.idempotency_key) throw new AppError('IDEMPOTENCY_KEY_REQUIRED', '创建任务必须在 JSON 或 --idempotency-key 中提供稳定的幂等键');
    try { output(await request(`/tasks${validate ? '/validate' : ''}`, { method: 'POST', body: form, timeoutMs: options.requestTimeout * 1000 })); }
    catch (error) { error.details = { ...error.details, idempotency_key: input.idempotency_key }; throw error; }
  });
  tasks.command('list').option('--limit <number>', '每页条数', integer, 30).option('--offset <number>', '分页偏移', integer, 0).action(async o => output(await request(`/tasks?limit=${o.limit}&offset=${o.offset}`)));
  tasks.command('get <id>').action(async id => output(await request(`/tasks/${encodeURIComponent(id)}`)));
  tasks.command('wait <id>').option('--timeout <seconds>', '最长等待秒数；超时不取消任务', number, 600).action(async (id, options) => {
    const deadline = Date.now() + options.timeout * 1000;
    let task;
    do {
      task = await request(`/tasks/${encodeURIComponent(id)}`, { timeoutMs: Math.max(1, Math.min(30_000, deadline - Date.now())) });
      if (done(task)) return output(task, taskExitCode(task));
      progress(`${task.finished}/${task.total} ${task.message}`);
      if (Date.now() < deadline) await delay(Math.min(1000, deadline - Date.now()));
    } while (Date.now() < deadline);
    throw new AppError('WAIT_TIMEOUT', '等待任务超时，任务仍由常驻服务管理', { details: { task_id: id, status: task?.status } });
  });
  tasks.command('logs <id>').option('--after <cursor>', '上次收到的事件序号', integer, 0).option('--follow', '持续跟踪直到任务结束').option('--jsonl', '每行一个 JSON 事件').option('--timeout <seconds>', '跟踪秒数', number, 600).action(async (id, options) => {
    let cursor = options.after;
    const all = [];
    const deadline = Date.now() + options.timeout * 1000;
    while (true) {
      const { events } = await request(`/tasks/${encodeURIComponent(id)}/events?after=${cursor}&limit=200`);
      for (const event of events) {
        cursor = event.seq;
        if (options.jsonl) process.stdout.write(JSON.stringify({ schema_version: 1, task_id: id, ...event }) + '\n');
        else all.push(event);
      }
      if (events.length === 200) continue;
      if (!options.follow || done(await request(`/tasks/${encodeURIComponent(id)}`))) break;
      if (Date.now() >= deadline) throw new AppError('WAIT_TIMEOUT', '日志跟踪超时，任务仍在运行', { details: { task_id: id, cursor } });
      await delay(500);
    }
    if (!options.jsonl) output({ events: all, cursor });
  });
  for (const verb of ['cancel', 'close-windows']) tasks.command(`${verb} <id>`).action(async id => output(await request(`/tasks/${encodeURIComponent(id)}/${verb}`, { method: 'POST' })));
  tasks.command('retry <id>').option('--failed-only', '仅重试失败或中断账号（默认行为）').option('--account-id <id>').option('--platform <key>').action(async (id, options) => output(await request(`/tasks/${encodeURIComponent(id)}/retry`, { method: 'POST', body: { account_id: options.accountId, platform: options.platform } })));
  tasks.command('reconcile <id>').requiredOption('--platform <key>').requiredOption('--account-id <id>').requiredOption('--result <submitted|not_submitted>').requiredOption('--note <text>', '在平台核实的依据，不能凭猜测填写').action(async (id, options) => output(await request(`/tasks/${encodeURIComponent(id)}/reconcile`, { method: 'POST', body: { platform: options.platform, account_id: options.accountId, result: options.result, note: options.note } })));
  tasks.command('verify <id>').description('在原任务窗口重新读取回执，不会再次点击发布').option('--platform <key>').option('--account-id <id>').action(async (id, options) => {
    const task = await request(`/tasks/${encodeURIComponent(id)}/verify`, { method: 'POST', body: { platform: options.platform, account_id: options.accountId }, timeoutMs: 60_000 });
    output(task, taskExitCode(task));
  });
  tasks.command('artifacts <id>').description('列出每个账号的截图和 HTML 证据').action(async id => { const task = await request(`/tasks/${encodeURIComponent(id)}`); output({ task_id: id, artifacts: task.items.flatMap(i => (i.artifacts || []).map(file => ({ platform: i.platform_key, account_id: i.account_id, path: file, local_path: path.join(root(), 'task_files', 'managed', id, file) }))) }); });

  try {
    await program.parseAsync(argv);
    if (!program.args.length) program.help();
  } catch (caught) {
    if (['commander.helpDisplayed', 'commander.version'].includes(caught.code)) return;
    const error = caught.code?.startsWith('commander.') ? new AppError('INVALID_ARGUMENT', caught.message) : caught;
    if (error.code === 'ENOENT') { error.code = 'FILE_NOT_FOUND'; error.status = 400; }
    const json = argv.includes('--json') || argv.includes('--jsonl');
    if (json) process.stdout.write(JSON.stringify(errorBody(error)) + '\n');
    else process.stderr.write(`${error.code || 'ERROR'}: ${error.message}\n`);
    process.exitCode = errorExitCode(error);
  }
}
