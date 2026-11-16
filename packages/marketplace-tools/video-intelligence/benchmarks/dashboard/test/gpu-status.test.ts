import test from 'node:test';
import assert from 'node:assert/strict';
import { gpuServicesReady } from '../lib/gpu-status.js';

test('GPU readiness requires both remote services, even when providers are live locally', () => {
  assert.equal(
    gpuServicesReady([
      { name: 'local provider controller', state: 'running' },
      { name: 'benchmark controller', state: 'unreachable' },
    ]),
    false,
  );
  assert.equal(
    gpuServicesReady([
      { name: 'benchmark controller', state: 'running' },
      { name: 'canonical video runtime', state: 'unreachable' },
    ]),
    false,
  );
  assert.equal(
    gpuServicesReady([
      { name: 'benchmark controller', state: 'running' },
      { name: 'canonical video runtime', state: 'running' },
    ]),
    true,
  );
});
