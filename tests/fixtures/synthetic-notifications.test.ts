import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('development fixture catalog has at least 30 synthetic notifications and no real-data claim', () => {
  const fixtures = JSON.parse(
    readFileSync('datasets/fixtures/synthetic-notifications.json', 'utf8'),
  ) as Array<{ fixture_id: string; data_origin: string; benchmark_status: string; text: string }>;
  assert.ok(fixtures.length >= 30);
  assert.equal(new Set(fixtures.map((fixture) => fixture.fixture_id)).size, fixtures.length);
  for (const fixture of fixtures) {
    assert.equal(fixture.data_origin, 'synthetic');
    assert.equal(fixture.benchmark_status, 'development_only');
    assert.ok(fixture.text.length > 0);
  }
});
