import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { AppError } from './errors.js';

export const instanceFile = root => path.join(root, '.fabu', 'instance.json');
export async function discoverService(dataRoot) {
  let instance;
  try { instance = JSON.parse(fs.readFileSync(instanceFile(dataRoot), 'utf8')); }
  catch { return null; }
  if (instance.api_version !== 1 || instance.data_root !== path.resolve(dataRoot) || !/^http:\/\/127\.0\.0\.1:\d+$/.test(instance.url) || !instance.token) return null;
  try {
    const response = await fetch(`${instance.url}/health`, { signal: AbortSignal.timeout(1500) });
    const health = await response.json();
    if (!response.ok || health.name !== 'Publish Ready' || health.instance_id !== instance.instance_id || health.api_version !== 1) return null;
    return instance;
  } catch { return null; }
}

export async function requireService(dataRoot) {
  const instance = await discoverService(dataRoot);
  if (!instance) throw new AppError('SERVICE_UNAVAILABLE', '未找到本数据目录的运行服务，请先执行 fabu service start', { status: 503, retryable: true, nextAction: { command: 'service start' } });
  return instance;
}

export async function requestService(instance, route, { method = 'GET', body, timeoutMs = 30_000, signal } = {}) {
  const form = body instanceof FormData;
  let response;
  try {
    response = await fetch(`${instance.url}/api/v1${route}`, { method, headers: { Authorization: `Bearer ${instance.token}`, ...(!form && body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : form ? body : JSON.stringify(body), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const timeout = error.name === 'TimeoutError';
    throw new AppError(timeout ? 'REQUEST_TIMEOUT' : 'SERVICE_UNAVAILABLE', timeout ? '请求等待超时；创建任务时请用同一幂等键查询或重试' : '服务连接中断；任务可能仍在执行，请查询任务或使用原幂等键重试', { status: 503, retryable: true });
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.success) throw new AppError(result?.error?.code || 'HTTP_ERROR', result?.error?.message || result?.detail || `HTTP ${response.status}`, { status: response.status, retryable: result?.error?.retryable, nextAction: result?.error?.next_action, details: result?.error?.details });
  return result.data;
}

export async function startBackgroundService(dataRoot, { port } = {}) {
  const existing = await discoverService(dataRoot);
  if (existing) return { ...publicInstance(existing), reused: true };
  const folder = path.join(dataRoot, '.fabu');
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  const logPath = path.join(folder, 'service.log');
  const log = fs.openSync(logPath, 'a', 0o600);
  const entry = fileURLToPath(new URL('../server.js', import.meta.url));
  let spawnError;
  const child = spawn(process.execPath, [entry], { cwd: path.dirname(entry), env: { ...process.env, PUBLISHER_DATA_ROOT: dataRoot, ...(port !== undefined ? { PORT: String(port) } : {}) }, detached: true, stdio: ['ignore', log, log], windowsHide: true });
  child.once('error', error => { spawnError = error; });
  child.unref();
  fs.closeSync(log);
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const instance = await discoverService(dataRoot);
    if (instance) return { ...publicInstance(instance), reused: instance.pid !== child.pid };
    if (spawnError) throw new AppError('SERVICE_START_FAILED', spawnError.message, { status: 503 });
    if (child.exitCode !== null) break;
    await delay(200);
  }
  throw new AppError('SERVICE_START_FAILED', `服务启动失败或超时，请查看 ${logPath}`, { status: 503, retryable: true });
}

export function publicInstance({ token: _token, ...instance }) { return instance; }
