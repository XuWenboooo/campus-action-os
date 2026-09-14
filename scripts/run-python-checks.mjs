import { spawnSync } from 'node:child_process';

const mode = process.argv[2] ?? 'all';
const commands = {
  contracts: ['-m', 'pytest', '-q', 'tests/contracts'],
  benchmark: ['-m', 'unittest', 'discover', '-s', 'tests/benchmark', '-p', 'test*.py', '-v'],
  integration: ['-m', 'pytest', '-q', 'tests/integration'],
  syntax: ['-m', 'compileall', '-q', 'tests', 'tools'],
  audit: ['tools/benchmark/cab.py', 'audit', 'benchmark/dev_samples.jsonl', '--development'],
};

const modes =
  mode === 'all' ? ['syntax', 'contracts', 'benchmark', 'integration', 'audit'] : [mode];
const candidates =
  process.platform === 'win32'
    ? [
        ['py', ['-3']],
        ['python', []],
      ]
    : [
        ['python3', []],
        ['python', []],
      ];
let selected;
for (const [command, prefix] of candidates) {
  const probe = spawnSync(command, [...prefix, '--version'], { stdio: 'ignore' });
  if (probe.status === 0) {
    selected = [command, prefix];
    break;
  }
}
if (!selected) {
  console.error('Python 3.11+ is required; no Python executable was found.');
  process.exit(1);
}

for (const args of modes.map((item) => commands[item])) {
  if (!args) {
    console.error(`Unknown Python check: ${mode}`);
    process.exit(1);
  }
  const result = spawnSync(selected[0], [...selected[1], ...args], { stdio: 'inherit' });
  if (result.error || result.status !== 0) process.exit(result.status ?? 1);
}
