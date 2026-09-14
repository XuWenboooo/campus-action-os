import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const manifestPath = resolve(root, 'docs/releases/m2-text-contract-v0.1.0.manifest.sha256');
const lines = (await readFile(manifestPath, 'utf8'))
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'));

if (lines.length === 0) throw new Error('M2 manifest is empty');
for (const line of lines) {
  const match = line.match(/^([a-f0-9]{64})\s+(.+)$/);
  if (!match) throw new Error(`Invalid manifest line: ${line}`);
  const [, expected, relativePath] = match;
  let content;
  try {
    content = execFileSync('git', ['show', `m2-text-contract-v0.1.0:${relativePath}`], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    content = await readFile(resolve(root, relativePath));
  }
  const actual = createHash('sha256').update(content).digest('hex');
  if (actual !== expected) throw new Error(`Manifest hash mismatch: ${relativePath}`);
}
console.log(`Verified ${lines.length} M2 interface manifest entries.`);
