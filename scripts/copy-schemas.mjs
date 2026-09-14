import { cp, mkdir } from 'node:fs/promises';

for (const relative of ['schemas', 'benchmark/schema']) {
  await mkdir(`dist/${relative}`, { recursive: true });
  await cp(relative, `dist/${relative}`, { recursive: true });
}
