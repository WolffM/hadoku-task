#!/usr/bin/env node
/**
 * Fail the build if any `exports` subpath in package.json points at a file that
 * wasn't produced.
 *
 * @wolffm/task 3.4.93-3.4.96 shipped with `./api` -> dist/server/index.js while
 * dist/server/ was missing entirely, because `tsc -p tsconfig.server.json` runs
 * with `incremental: true` and a warm .tsbuildinfo on the persistent
 * self-hosted runner: `vite build` wipes dist/, tsc sees no *source* changes
 * (it tracks sources, not whether the output still exists), emits nothing, and
 * exits 0. The tarball then packed without dist/server and every consumer hit
 * `Could not resolve "@wolffm/task/api"` — which took down the task-api worker
 * deploy.
 *
 * tsconfig.server.json now sets `incremental: false`, so that specific cause is
 * gone. This check is the backstop: any future build that silently drops an
 * entrypoint fails here instead of on a consumer's deploy.
 *
 *   node scripts/verify-dist.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

const targets = [];
for (const [subpath, value] of Object.entries(pkg.exports || {})) {
  const paths = typeof value === 'string' ? [value] : Object.values(value);
  for (const p of paths) {
    if (typeof p === 'string' && p.startsWith('./')) targets.push({ subpath, file: p });
  }
}

const missing = targets.filter(({ file }) => !existsSync(resolve(ROOT, file)));

if (missing.length) {
  console.error(`verify-dist: FAILED — ${missing.length} export target(s) missing from the build\n`);
  for (const { subpath, file } of missing) {
    console.error(`  "${subpath}" -> ${file}`);
  }
  console.error('\n  Publishing now would ship a package whose exports do not resolve.');
  console.error('  Check that every build:* step actually emitted (a warm .tsbuildinfo can');
  console.error('  make tsc exit 0 without writing anything after dist/ was cleaned).');
  process.exit(1);
}

console.log(`verify-dist: OK — all ${targets.length} export targets present.`);
