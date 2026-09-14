import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
const patterns = [
  /sk-[A-Za-z0-9]{12,}/,
  /AIza[0-9A-Za-z_-]{20,}/,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
  /(?:appsecret|api[_-]?key|token)\s*[:=]\s*['\"][^'\"]{12,}/i,
];
const hits = files.filter((file) =>
  patterns.some((pattern) => pattern.test(readFileSync(file, 'utf8'))),
);
if (hits.length) {
  console.error(`Potential secret in tracked files: ${hits.join(', ')}`);
  process.exit(1);
}
console.log(`Secret scan passed (${files.length} tracked files)`);
