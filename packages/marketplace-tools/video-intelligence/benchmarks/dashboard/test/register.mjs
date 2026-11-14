// Registers a resolve hook so the contract-faithful `.js` import specifiers
// (required by Next / NodeNext output) also resolve to their `.ts` sources
// when running the suite under `node --experimental-strip-types`.
import { register } from 'node:module';
register('./ts-resolve.mjs', import.meta.url);
