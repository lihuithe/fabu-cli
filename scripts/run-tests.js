import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Tests never read, migrate, or alter the user's account registry and task database.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fabu-tests-'));
const requested = process.argv.slice(2);
const files = requested.length ? requested : fs.readdirSync('test').filter(file => file.endsWith('.test.js')).map(file => path.join('test', file));
const child = spawn(process.execPath, ['--test', ...files], { stdio: 'inherit', env: { ...process.env, PUBLISHER_DATA_ROOT: root } });
child.on('error', error => { console.error(error); fs.rmSync(root, { recursive: true, force: true }); process.exitCode = 1; });
child.on('exit', (code, signal) => { fs.rmSync(root, { recursive: true, force: true }); process.exitCode = code ?? (signal ? 1 : 0); });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
