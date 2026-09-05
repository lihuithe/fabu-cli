import open from 'open';
import { applicationDataRoot } from '../src/runtime-paths.js';
import { discoverService } from '../src/service-client.js';

const existing = await discoverService(applicationDataRoot(import.meta.url, 1));
const runtime = existing ? null : await import('../server.js');
const baseUrl = existing?.url || `http://127.0.0.1:${runtime.server.address().port}`;
const url = `${baseUrl}/accounts`;
console.log(`浏览器工作台：${url}${existing ? '（复用已运行的本地服务）' : '\n保持终端运行，按 Ctrl+C 停止服务。'}`);
if (process.env.OPEN_BROWSER !== '0') {
  try { await open(url); }
  catch (error) { console.error(`自动打开浏览器失败，请手动访问 ${url}：${error.message}`); }
}
