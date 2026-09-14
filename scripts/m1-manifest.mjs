import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = resolve(repositoryRoot, 'docs/releases/m1-foundation-v1.0.0.manifest.sha256');
const manifestFiles = [
  'docs/frozen/信息翻译器_一等奖版_冻结实验与程序目标_v1.0.md',
  'schemas/v1/verified-action-object.schema.json',
  'schemas/v1/action-graph.schema.json',
  'benchmark/schema/campus-action-bench-v1.schema.json',
  'packages/protocol/src/index.ts',
  'package-lock.json',
  'requirements-dev.txt',
  '.github/workflows/ci.yml',
];

async function bytesAtM1Tag(relativePath, currentPath) {
  try {
    return execFileSync('git', ['show', `m1-foundation-v1.0.0:${relativePath}`], {
      cwd: repositoryRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return readFile(currentPath);
  }
}

async function sha256(path, relativePath) {
  const bytes = await bytesAtM1Tag(relativePath, path);
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

function lineFor(hash, path) {
  return `${hash}  ${path}`;
}

async function createManifest() {
  const lines = [];
  for (const relativePath of manifestFiles) {
    lines.push(
      lineFor(await sha256(resolve(repositoryRoot, relativePath), relativePath), relativePath),
    );
  }
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${lines.join('\n')}\n`, 'utf8');
  console.log(`Wrote ${relative(repositoryRoot, manifestPath)} (${lines.length} files).`);
}

async function verifyManifest() {
  const content = await readFile(manifestPath, 'utf8');
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (lines.length !== manifestFiles.length) {
    throw new Error(`Manifest has ${lines.length} entries; expected ${manifestFiles.length}.`);
  }
  const expectedPaths = new Set(manifestFiles);
  const seenPaths = new Set();
  for (const line of lines) {
    const match = /^(\S{64})  (.+)$/.exec(line);
    if (!match) throw new Error(`Invalid manifest line: ${line}`);
    const [, recordedHash, relativePath] = match;
    if (!expectedPaths.has(relativePath) || seenPaths.has(relativePath)) {
      throw new Error(`Unexpected or duplicate manifest path: ${relativePath}`);
    }
    seenPaths.add(relativePath);
    const actualHash = await sha256(resolve(repositoryRoot, relativePath), relativePath);
    if (recordedHash !== actualHash) {
      throw new Error(`Hash mismatch for ${relativePath}: ${recordedHash} != ${actualHash}`);
    }
  }
  console.log(`Verified ${lines.length} M1 manifest entries.`);
}

const command = process.argv[2] ?? 'verify';
try {
  if (command === 'create') await createManifest();
  else if (command === 'verify') await verifyManifest();
  else throw new Error(`Unknown command: ${command}. Use create or verify.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
