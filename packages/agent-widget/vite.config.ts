import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The widget ships as ONE self-contained IIFE file.
 *
 * - React/React-DOM are bundled, not externalized: the host page is a stranger's
 *   website and may have no bundler, no React, or an incompatible React.
 * - CSS is imported with `?inline` and injected into the Shadow DOM at runtime,
 *   so there is no second asset to deploy and no stylesheet to leak into the
 *   host page. `cssCodeSplit: false` keeps Vite from emitting a stray file.
 * - `process.env.NODE_ENV` is defined so React tree-shakes to its production
 *   build; without it the bundle keeps React's dev warnings and doubles in size.
 */
export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    emptyOutDir: true,
    minify: 'esbuild',
    sourcemap: false,
    lib: {
      entry: 'src/index.tsx',
      name: 'LarkupAgent',
      formats: ['iife'],
      fileName: () => 'widget.js',
    },
  },
  esbuild: {
    legalComments: 'none',
  },
});
