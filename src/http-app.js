import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import express from 'express';
import multer from 'multer';
import { APP_NAME, APP_VERSION } from './app-meta.js';
import { ACCOUNT_ASSET_ROOT } from './account-binding.js';
import { applicationRoot } from './runtime-paths.js';
import { PLATFORMS } from './platforms.js';
import { CAPABILITIES, taskJSONSchema, legacyInput } from './task-schema.js';
import { AppError, errorBody } from './errors.js';

const ROOT = applicationRoot(import.meta.url, 1);
const assetVersion = `publish-ready-${APP_VERSION}`;
const SMALL_FILE_DIALOG_SCRIPT = String.raw`
Add-Type @'
using System;
using System.Text;
using System.Threading;
using System.Runtime.InteropServices;

public static class PublisherFileDialogWindow {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
  public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public int dwFlags; }
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Auto)] static extern int GetClassName(IntPtr hWnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int command);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Auto)] static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);

  public static int EnsureSmallWindow() {
    IntPtr window = GetForegroundWindow();
    if (window == IntPtr.Zero) return 0;
    var className = new StringBuilder(128);
    GetClassName(window, className, className.Capacity);
    if (className.ToString() != "#32770") return 0;
    RECT current;
    if (!GetWindowRect(window, out current)) return 0;
    var info = new MONITORINFO();
    info.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
    if (!GetMonitorInfo(MonitorFromWindow(window, 2), ref info)) return 0;
    int workWidth = info.rcWork.Right - info.rcWork.Left;
    int workHeight = info.rcWork.Bottom - info.rcWork.Top;
    int targetWidth = Math.Min(960, workWidth - 80);
    int targetHeight = Math.Min(680, workHeight - 80);
    int currentWidth = current.Right - current.Left;
    int currentHeight = current.Bottom - current.Top;
    if (Math.Abs(currentWidth - targetWidth) <= 8 && Math.Abs(currentHeight - targetHeight) <= 8) return 2;
    int x = info.rcWork.Left + (workWidth - targetWidth) / 2;
    int y = info.rcWork.Top + (workHeight - targetHeight) / 2;
    ShowWindow(window, 9);
    Thread.Sleep(40);
    SetWindowPos(window, IntPtr.Zero, x, y, targetWidth, targetHeight, 0x0060);
    return 1;
  }
}
'@
$deadline = [DateTime]::UtcNow.AddSeconds(8)
while ([DateTime]::UtcNow -lt $deadline) {
  $status = [PublisherFileDialogWindow]::EnsureSmallWindow()
  if ($status -eq 2) { break }
  Start-Sleep -Milliseconds 40
}
`;

function prepareSmallFileDialog() {
  if (process.platform !== "win32") return false;
  const encoded = Buffer.from(SMALL_FILE_DIALOG_SCRIPT, "utf16le").toString("base64");
  const watcher = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encoded], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  });
  watcher.unref();
  return true;
}

function renderPage(name, publish = false) {
  let html = fs.readFileSync(path.join(ROOT, "web_pages", name), "utf8");
  html = html.replace("</head>", `<link href="/static/shell-account.css?v=${assetVersion}" rel="stylesheet"><link href="/static/shell-layout.css?v=${assetVersion}" rel="stylesheet"></head>`);
  html = html.replaceAll('/static/shell.js', '/static/core-shell.js').replaceAll('/static/core-shell.js', `/static/core-shell.js?v=${assetVersion}`);
  if (name === "accounts.html") html = html.replaceAll('/static/accounts.js', `/static/accounts.js?v=${assetVersion}`).replaceAll('/static/accounts-bind.css', `/static/accounts-bind.css?v=${assetVersion}`);
  if (name === "image_text_publish.html") html = html.replaceAll('/static/image-text-publish.js', `/static/image-text-publish.js?v=${assetVersion}`).replaceAll('/static/image-text-publish.css', `/static/image-text-publish.css?v=${assetVersion}`);
  if (publish) {
    html = html.replace('data-page="publish"', `data-page="publish" data-small-file-dialog="${process.platform === "win32"}"`);
    html = html.replaceAll('/static/publish-v3.css', '/static/platform-link.css');
    html = html.replaceAll('/static/publish-v3.js', `/static/publish-v3.js?v=${assetVersion}`);
    html = html.replace(`</body>`, `<script src="/static/platform-link.js?v=${assetVersion}"></script></body>`);
  }
  return html;
}

function uploadMap(files) {
  return Object.fromEntries(Object.entries(files || {}).flatMap(([field, entries]) => entries.map((file, index) => [`${field}:${index}`, file])));
}
function cleanUploads(files, root) {
  for (const file of Object.values(files || {}).flat()) {
    if (path.dirname(path.resolve(file.path)) === path.resolve(root)) fs.rmSync(file.path, { force: true });
  }
}
const envelope = data => ({ schema_version: 1, success: true, data });
function boundedNumber(value, fallback, max) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > max) throw new AppError('INVALID_INPUT', '分页参数无效');
  return number;
}

export function createApp({ service, dataRoot, token, instanceId, stop = () => {} }) {
  const app = express();
  const tempRoot = path.join(dataRoot, 'task_files', '_incoming_v1');
  fs.mkdirSync(tempRoot, { recursive: true });
  const upload = multer({ dest: tempRoot, limits: { files: 22, fields: 80, fieldSize: 1024 * 1024, fileSize: 20 * 1024 ** 3 } });
  const coverFields = ['3_4', '4_3', '16_9'].map(r => ({ name: `cover_${r}`, maxCount: 1 }));
  const videoUpload = upload.fields([{ name: 'video', maxCount: 1 }, ...coverFields]);
  const imageUpload = upload.fields([{ name: 'images', maxCount: 18 }]);
  const agentUpload = upload.fields([{ name: 'video', maxCount: 1 }, { name: 'images', maxCount: 18 }, ...coverFields]);
  const accounts = service.accounts;
  accounts.accountLocks = service.locks;
  app.use(express.json({ limit: '1mb' }));
  app.use((_request, response, next) => { response.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); next(); });
  app.use((request, _response, next) => {
    const host = (request.get('Host') || '').split(':')[0];
    if (!['127.0.0.1', 'localhost'].includes(host)) return next(new AppError('FORBIDDEN', '仅支持本机访问', { status: 403 }));
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return next();
    if (request.get('Sec-Fetch-Site') === 'cross-site') return next(new AppError('FORBIDDEN', '拒绝跨站请求', { status: 403 }));
    const origin = request.get('Origin');
    if (origin) {
      try { const value = new URL(origin); if (value.protocol !== 'http:' || value.host !== request.get('Host')) throw new Error(); }
      catch { return next(new AppError('FORBIDDEN', '拒绝跨站请求', { status: 403 })); }
    }
    next();
  });
  app.use('/static', express.static(path.join(ROOT, 'web_static'), { etag: false, maxAge: 0 }));
  app.use('/account-assets', express.static(ACCOUNT_ASSET_ROOT, { etag: false, maxAge: 0 }));
  app.get('/', (_req, res) => res.redirect('/accounts'));
  app.get('/accounts', (_req, res) => res.type('html').send(renderPage('accounts.html')));
  app.get('/publish', (_req, res) => res.type('html').send(renderPage('publish_v3.html', true)));
  app.get('/image-text-publish', (_req, res) => res.type('html').send(renderPage('image_text_publish.html')));
  app.get('/health', (_req, res) => res.json({ status: 'ok', name: APP_NAME, version: APP_VERSION, runtime: `node ${process.version}`, platforms: Object.keys(PLATFORMS), api_version: 1, instance_id: instanceId }));
  app.get('/api/app/meta', (_req, res) => res.json({ success: true, name: APP_NAME, version: APP_VERSION }));
  app.post('/api/ui/prepare-file-dialog', (_req, res) => res.json({ success: true, watcher_started: prepareSmallFileDialog() }));
  const checkPlatform = key => { if (!PLATFORMS[key]) throw new AppError('NOT_FOUND', '平台不存在', { status: 404 }); };
  const startBinding = req => { checkPlatform(req.params.platformKey); return accounts.startBinding(req.params.platformKey, req.body?.remark ?? '', req.body?.account_id ?? ''); };
  app.get('/api/accounts', (_req, res) => res.json({ success: true, accounts: accounts.accountStatus() }));
  app.post('/api/accounts/:platformKey/bind', (req, res) => res.json({ success: true, platform: req.params.platformKey, binding_id: startBinding(req), message: '已打开平台登录窗口，请完成登录' }));
  app.get('/api/accounts/:platformKey/bind/status', (req, res) => { checkPlatform(req.params.platformKey); res.json({ success: true, status: accounts.bindingStatus(req.params.platformKey) }); });
  app.get('/api/account-bindings/:bindingId/status', (req, res) => res.json({ success: true, status: accounts.bindingStatus(req.params.bindingId) }));
  app.post('/api/accounts/:platformKey/:accountId/refresh-profile', async (req, res) => { checkPlatform(req.params.platformKey); res.json({ success: true, account: await accounts.refreshAccountProfile(req.params.platformKey, req.params.accountId) }); });
  app.delete('/api/accounts/:platformKey/:accountId', (req, res) => { checkPlatform(req.params.platformKey); accounts.removeAccount(req.params.platformKey, req.params.accountId); res.json({ success: true }); });

  for (const [prefix, type, middleware] of [['/api/tasks', 'video', videoUpload], ['/api/image-text/tasks', 'image_text', imageUpload]]) {
    const taskFor = id => { const task = service.get(id); if (task.type !== type) throw new AppError('NOT_FOUND', '任务不存在', { status: 404 }); return task; };
    app.post(prefix, middleware, async (req, res) => {
      try {
        const { task } = await service.create(legacyInput(req.body, req.files, type), uploadMap(req.files));
        res.json({ success: true, ...task, task_id: task.id, cover_ratios: Object.keys(task.cover_details) });
      } finally { cleanUploads(req.files, tempRoot); }
    });
    app.get(prefix, (_req, res) => res.json({ success: true, tasks: service.store.all().filter(t => t.type === type).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 30) }));
    app.get(`${prefix}/:taskId`, (req, res) => res.json(taskFor(req.params.taskId)));
    for (const [suffix, handler] of [['cancel', id => service.cancel(id)], ['close-windows', id => service.closeWindows(id)], ['retry-failed', id => service.retry(id)]]) app.post(`${prefix}/:taskId/${suffix}`, async (req, res) => { taskFor(req.params.taskId); res.json({ success: true, task: await handler(req.params.taskId) }); });
  }

  app.use('/api/v1', (req, _res, next) => {
    const provided = Buffer.from(req.get('Authorization') || '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (!token || provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return next(new AppError('UNAUTHORIZED', '本地服务凭据无效，请重新发现服务', { status: 401 }));
    next();
  });
  app.get('/api/v1/capabilities', (_req, res) => res.json(envelope({ platforms: CAPABILITIES, runtime: { desktop_required: true, max_concurrency: service.maxConcurrency, max_windows: service.maxWindows, api_version: 1 } })));
  app.get('/api/v1/schema/task', (_req, res) => res.json(envelope(taskJSONSchema())));
  app.get('/api/v1/accounts', (_req, res) => res.json(envelope({ accounts: accounts.accountStatus(), verification: 'cached_login_state' })));
  app.post('/api/v1/accounts/:platformKey/login', (req, res) => res.status(202).json(envelope({ binding_id: startBinding(req), status: 'waiting_for_login', next_action: '请在打开的 Chrome 窗口完成平台登录' })));
  app.get('/api/v1/bindings/:id', (req, res) => {
    const status = accounts.bindingStatus(req.params.id);
    if (status.status === 'idle') throw new AppError('NOT_FOUND', '登录任务不存在或服务已重启，请重新发起登录', { status: 404 });
    res.json(envelope(status));
  });
  app.post('/api/v1/accounts/:platformKey/:accountId/refresh-profile', async (req, res) => { checkPlatform(req.params.platformKey); res.json(envelope(await accounts.refreshAccountProfile(req.params.platformKey, req.params.accountId))); });
  app.delete('/api/v1/accounts/:platformKey/:accountId', (req, res) => { checkPlatform(req.params.platformKey); accounts.removeAccount(req.params.platformKey, req.params.accountId); res.json(envelope({ removed: true })); });
  for (const validate of [true, false]) {
    app.post(`/api/v1/tasks${validate ? '/validate' : ''}`, agentUpload, async (req, res) => {
      try {
        let input;
        try { input = JSON.parse(req.body.manifest); } catch { throw new AppError('INVALID_INPUT', 'manifest 必须是有效的 JSON'); }
        const result = await service[validate ? 'validate' : 'create'](input, uploadMap(req.files));
        res.status(validate || result.reused ? 200 : 202).json(envelope(result));
      } finally { cleanUploads(req.files, tempRoot); }
    });
  }
  app.get('/api/v1/tasks', (req, res) => res.json(envelope({ tasks: service.list({ limit: boundedNumber(req.query.limit, 30, 100), offset: boundedNumber(req.query.offset, 0, 1_000_000) }) })));
  app.get('/api/v1/tasks/:id', (req, res) => res.json(envelope(service.get(req.params.id))));
  app.get('/api/v1/tasks/:id/events', (req, res) => res.json(envelope({ events: service.events(req.params.id, boundedNumber(req.query.after, 0, Number.MAX_SAFE_INTEGER), boundedNumber(req.query.limit, 200, 1000)) })));
  app.get('/api/v1/tasks/:id/artifact', (req, res) => res.download(service.artifact(req.params.id, String(req.query.path || ''))));
  app.post('/api/v1/tasks/:id/cancel', async (req, res) => res.json(envelope(await service.cancel(req.params.id))));
  app.post('/api/v1/tasks/:id/close-windows', async (req, res) => res.json(envelope(await service.closeWindows(req.params.id))));
  app.post('/api/v1/tasks/:id/retry', async (req, res) => res.json(envelope(await service.retry(req.params.id, { accountId: req.body?.account_id, platform: req.body?.platform }))));
  app.post('/api/v1/tasks/:id/reconcile', (req, res) => res.json(envelope(service.reconcile(req.params.id, req.body || {}))));
  app.post('/api/v1/tasks/:id/verify', async (req, res) => res.json(envelope(await service.verify(req.params.id, req.body || {}))));
  app.post('/api/v1/service/stop', (_req, res) => { res.json(envelope({ stopping: true })); setImmediate(stop); });
  app.use((_req, _res, next) => next(new AppError('NOT_FOUND', '接口不存在', { status: 404 })));
  app.use((error, req, res, _next) => {
    cleanUploads(req.files, tempRoot);
    if (error instanceof multer.MulterError) error = new AppError('INVALID_UPLOAD', error.message);
    if (error.type === 'entity.parse.failed') error = new AppError('INVALID_INPUT', '请求 JSON 格式无效');
    if (!error.status && !error.code) console.error(error);
    res.status(error.status || 500).json(errorBody(error));
  });
  return app;
}
