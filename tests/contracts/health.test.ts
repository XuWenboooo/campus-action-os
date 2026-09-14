import test from 'node:test';
import assert from 'node:assert/strict';
import { protocolVersion } from '@campus-action-os/protocol';

test('protocol exposes a version without defining the final action schema', () => {
  assert.match(protocolVersion, /^\d+\.\d+\.\d+$/);
});
