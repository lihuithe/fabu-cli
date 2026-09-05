import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const files = ['server.js', ...['src', 'bin', 'scripts', 'web_static'].flatMap(folder => fs.readdirSync(folder).filter(f => f.endsWith('.js')).map(f => `${folder}/${f}`))];
for (const file of files) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
console.log(`语法检查通过：${files.length} 个 JavaScript 文件`);
