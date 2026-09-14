import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('development fixture catalog has at least 30 synthetic notifications and no real-data claim', () => {
  const fixtures = JSON.parse(
    readFileSync('datasets/fixtures/synthetic-notifications.json', 'utf8'),
  ) as Array<{
    fixture_id: string;
    data_origin: string;
    benchmark_status: string;
    text: string;
    expected: {
      action_count?: number;
      evidence_spans?: Array<[number, number]>;
    };
  }>;
  assert.ok(fixtures.length >= 30);
  assert.equal(new Set(fixtures.map((fixture) => fixture.fixture_id)).size, fixtures.length);
  for (const fixture of fixtures) {
    assert.equal(fixture.data_origin, 'synthetic');
    assert.equal(fixture.benchmark_status, 'development_only');
    assert.ok(fixture.text.length > 0);
    assert.ok(Number.isInteger(fixture.expected.action_count ?? 1));
    assert.ok((fixture.expected.action_count ?? 1) > 0);
    for (const span of fixture.expected.evidence_spans ?? []) {
      assert.equal(span.length, 2);
      assert.ok(Number.isInteger(span[0]));
      assert.ok(Number.isInteger(span[1]));
      assert.ok(span[0] >= 0 && span[0] < span[1] && span[1] <= fixture.text.length);
      assert.ok(fixture.text.slice(span[0], span[1]).trim().length > 0);
    }
  }
});
