import { applicationDataRoot } from './src/runtime-paths.js';
import { startService } from './src/service-runtime.js';

const runtime = await startService({ dataRoot: applicationDataRoot(import.meta.url), port: Number(process.env.PORT ?? 8000) });
const { app, server, service, shutdown } = runtime;
console.log(`发布 Ready 本地服务：${runtime.instance.url}`);
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => { void shutdown(); });
export { app, server, service, shutdown };
