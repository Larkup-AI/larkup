import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalBodyHash } from '../lib/server/auth.js';

// Note: checkMutationGuards reads a cached server config built from env at first
// call. Origin/Content-Type/Idempotency enforcement is exercised end-to-end via
// the BFF route; here we lock down the idempotency body-hash canonicalization.

test('canonicalBodyHash is stable regardless of key order', async () => {
  const a = await canonicalBodyHash({ expectedRevision: '12', phase: 'pilot' });
  const b = await canonicalBodyHash({ phase: 'pilot', expectedRevision: '12' });
  assert.equal(a, b);
});

test('canonicalBodyHash differs when the body differs', async () => {
  const a = await canonicalBodyHash({ expectedRevision: '12' });
  const b = await canonicalBodyHash({ expectedRevision: '13' });
  assert.notEqual(a, b);
});

test('canonicalBodyHash handles nested objects and arrays deterministically', async () => {
  const a = await canonicalBodyHash({ variants: ['b', 'a'], opts: { z: 1, a: 2 } });
  const b = await canonicalBodyHash({ opts: { a: 2, z: 1 }, variants: ['b', 'a'] });
  assert.equal(a, b);
  // array order IS significant (variant order matters)
  const c = await canonicalBodyHash({ variants: ['a', 'b'] });
  const d = await canonicalBodyHash({ variants: ['b', 'a'] });
  assert.notEqual(c, d);
});
