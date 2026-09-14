import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../apps/student-miniapp');
const app = JSON.parse(readFileSync(resolve(root, 'app.json'), 'utf8'));
if (!Array.isArray(app.pages) || app.pages.length === 0)
  throw new Error('miniapp app.json has no pages');

const files = ['app.js', 'app.json', 'app.wxss', 'sitemap.json', 'utils/api.js'];
for (const page of app.pages) files.push(`${page}.js`, `${page}.json`, `${page}.wxml`);
for (const relative of files) {
  if (!existsSync(resolve(root, relative))) throw new Error(`Missing miniapp file: ${relative}`);
}
for (const relative of files.filter((file) => file.endsWith('.json'))) {
  JSON.parse(readFileSync(resolve(root, relative), 'utf8'));
}
for (const relative of files.filter((file) => file.endsWith('.js'))) {
  const result = spawnSync(process.execPath, ['--check', resolve(root, relative)], {
    encoding: 'utf8',
  });
  if (result.status !== 0)
    throw new Error(`Invalid miniapp JavaScript: ${relative}\n${result.stderr}`);
}
const source = files
  .filter((file) => file.endsWith('.js'))
  .map((file) => readFileSync(resolve(root, file), 'utf8'))
  .join('\n');
if (/appsecret|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|api[_-]?key\s*[:=]/i.test(source))
  throw new Error('Potential secret found in miniapp source');
console.log(
  `Miniapp static check passed (${app.pages.length} pages); MANUAL_VERIFICATION_REQUIRED`,
);
