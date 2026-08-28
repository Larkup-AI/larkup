import { config } from 'dotenv';

config({ path: new URL('../../../packages/marketplace/.env', import.meta.url) });

await import('../src/index.ts');
