import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * Vitest ran without a config until `src/lib/` grew its first `@/` import.
 *
 * The specs import the modules under test by relative path, which worked only for
 * as long as those modules had no internal imports of their own — the moment
 * `local-collection.tsx` imported `@/lib/write-gate`, every store spec failed to
 * resolve. Mirroring the two aliases from `tsconfig.json` here is the fix; the
 * alternative was banning the repo's own import convention from one directory.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@/assets': fileURLToPath(new URL('./assets', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
