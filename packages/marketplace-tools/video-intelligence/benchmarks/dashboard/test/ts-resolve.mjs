// Resolve hook: map relative `.js` specifiers to a sibling `.ts` file when one
// exists. Keeps source imports standards-compliant while letting the built-in
// TypeScript type-stripping loader run them directly in tests. Zero deps.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && specifier.endsWith('.js')) {
    const tsSpecifier = specifier.replace(/\.js$/, '.ts');
    try {
      const tsUrl = new URL(tsSpecifier, context.parentURL);
      if (existsSync(fileURLToPath(tsUrl))) return next(tsSpecifier, context);
    } catch {
      /* fall through to default resolution */
    }
  }
  return next(specifier, context);
}
