import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import lockfile from 'proper-lockfile';
import { createApp } from './http-app.js';
import { TaskService } from './task-service.js';
import { bindingManager, closeActiveBindingBrowsers } from './account-binding.js';
import { closeActiveBrowsers } from './runner.js';
import { AppError } from './errors.js';
import { APP_VERSION } from './app-meta.js';

export const instanceFile = root => path.join(root, '.fabu', 'instance.json');

export async function startService({ dataRoot, port = 8000, portAttempts = 20, accounts = bindingManager, runnerFactory } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new AppError('INVALID_CONFIG', 'PORT 必须是 0–65535 的整数');
  const folder = path.join(dataRoot, '.fabu');
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  let release;
  try { release = await lockfile.lock(path.join(folder, 'service'), { realpath: false, stale: 10_000, update: 2_000, retries: 0 }); }
  catch (error) { if (error.code === 'ELOCKED') throw new AppError('SERVICE_ALREADY_RUNNING', '此数据目录已有服务运行，或上次服务刚退出，请稍后重试', { status: 409, retryable: true }); throw error; }
  let service;
  let server;
  let shutdownPromise;
  const token = crypto.randomBytes(32).toString('hex');
  const instanceId = crypto.randomUUID();
  const shutdown = () => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      const closed = new Promise(resolve => { if (server?.listening) server.close(resolve); else resolve(); });
      server?.closeIdleConnections();
      await service?.shutdown();
      await Promise.all([closeActiveBrowsers(), closeActiveBindingBrowsers()]);
      server?.closeAllConnections();
      await closed;
      try {
        if (JSON.parse(fs.readFileSync(instanceFile(dataRoot), 'utf8')).instance_id === instanceId) fs.rmSync(instanceFile(dataRoot));
      } catch {}
      await release();
    })();
    return shutdownPromise;
  };
  try {
    // Only files in the managed incoming directory are stale after obtaining the instance lock.
    const incoming = path.join(dataRoot, 'task_files', '_incoming_v1');
    fs.mkdirSync(incoming, { recursive: true });
    for (const entry of fs.readdirSync(incoming, { withFileTypes: true })) if (entry.isFile()) fs.rmSync(path.join(incoming, entry.name), { force: true });
    service = new TaskService({ dataRoot, accounts, runnerFactory, maxConcurrency: Number(process.env.FABU_CONCURRENCY || 2), maxWindows: Number(process.env.FABU_MAX_WINDOWS || 8) });
    const app = createApp({ service, dataRoot, token, instanceId, stop: () => { void shutdown(); } });
    for (let attempt = 0; attempt < portAttempts; attempt++) {
      try {
        server = await new Promise((resolve, reject) => {
          const listener = app.listen(port ? port + attempt : 0, '127.0.0.1');
          listener.once('error', reject);
          listener.once('listening', () => { listener.removeListener('error', reject); resolve(listener); });
        });
        break;
      } catch (error) { if (error.code !== 'EADDRINUSE' || attempt === portAttempts - 1 || port + attempt >= 65535) throw error; }
    }
    const instance = { schema_version: 1, instance_id: instanceId, api_version: 1, version: APP_VERSION, pid: process.pid, url: `http://127.0.0.1:${server.address().port}`, token, data_root: dataRoot, started_at: new Date().toISOString() };
    const temporary = `${instanceFile(dataRoot)}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(instance), { mode: 0o600 });
    fs.renameSync(temporary, instanceFile(dataRoot));
    server.once('close', () => { void shutdown(); });
    return { app, server, service, instance, shutdown };
  } catch (error) { await service?.shutdown(); await release(); throw error; }
}
