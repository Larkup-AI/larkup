import { getWebUIUrl } from './utils/env';

async function globalTeardown() {
  console.log('\n🧹 E2E Global Teardown');

  // Stop a runtime started during tests.
  try {
    const res = await fetch(`${getWebUIUrl()}/api/projects/runtime`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop' }),
    });
    if (res.ok) {
      console.log('  ✓ Stopped Project Runtime');
    }
  } catch {
    // No runtime was running.
  }

  console.log('  ✓ Global teardown complete\n');
}

export default globalTeardown;
