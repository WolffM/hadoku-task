#!/usr/bin/env node
/**
 * Fail the build if any `exports` subpath in package.json points at a file that
 * wasn't produced.
 *
 * @wolffm/task 3.4.95-3.4.96 shipped with `./api` -> dist/server/index.js while
 * dist/server/ was missing entirely. Every consumer then hit
 * `Could not resolve "@wolffm/task/api"`, which took down the task-api worker
 * deploy.
 *
 * The cause is publish.yml building TWICE in one job: it builds, then bumps the
 * version, then runs "Rebuild after version bump". On the second `build:all`,
 * `vite build` wipes dist/ and `tsc -p tsconfig.server.json` — which inherited
 * `incremental: true` — sees no *source* changes and emits nothing, exiting 0.
 * TypeScript's incremental mode tracks sources, not whether its output still
 * exists. Only runs where the rebuild step fired produced a broken tarball;
 * single-build runs were fine, which is why this looked intermittent.
 *
 * (It is NOT runner-workspace reuse: actions/checkout cleans with
 * `git clean -ffdx` every run, so .tsbuildinfo cannot survive between runs.)
 *
 * The structural fix is to bump the version BEFORE building so the job builds
 * once; until then, `incremental: false` on the server build makes the second
 * build correct.
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
