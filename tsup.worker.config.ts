import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['worker/src/index.ts'],
  tsconfig: 'worker/tsconfig.json',
  format: ['esm'],
  dts: false,
  outDir: 'dist/worker',
  target: 'es2022',
  bundle: true,
  splitting: false,
  clean: false,
  // Keep these as external — the consumer (wrangler) resolves them
  external: ['@wolffm/task', '@wolffm/worker-utils', 'hono', '@hono/zod-openapi']
})
