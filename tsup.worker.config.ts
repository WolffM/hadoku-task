import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['worker/src/index.ts'],
  tsconfig: 'worker/tsconfig.json',
  format: ['esm'],
  // Emit dist/worker/index.d.ts. Without it the ./worker subpath resolves to a
  // bare .js and every consumer's `tsc --noEmit` fails with TS7016 ("implicitly
  // has an 'any' type") — hadoku_site's workers/task-api did, for as long as
  // this entry has existed. ./api and ./frontend always shipped types; this one
  // was the odd entry out.
  dts: true,
  outDir: 'dist/worker',
  target: 'es2022',
  bundle: true,
  splitting: false,
  clean: false,
  // Keep these as external — the consumer (wrangler) resolves them
  external: ['@wolffm/task', '@wolffm/worker-utils', 'hono', '@hono/zod-openapi']
})
