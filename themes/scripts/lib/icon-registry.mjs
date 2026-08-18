/**
 * Locate the icon registry, from either of the two trees it can live in.
 *
 * The scripts that need it run in two very different places:
 *
 *   - In this workspace, where `themes/src` is authored but `themes/dist` only
 *     exists after a build. Parsing the .ts source is what lets `check:icons`
 *     run on a clean checkout with no build step.
 *   - From a consumer's node_modules, where the shape of the tarball decides
 *     what is there at all.
 *
 * Reading only `src/icons/registry.generated.ts` made the second case depend on
 * `src/icons` being listed in package.json `files`. It was not, up to and
 * including 5.6.2, so every consumer that ran the documented command got
 * `registry.generated.ts is missing — run pnpm run generate:icons` — advice that
 * cannot work in a consumer repo, for a file npm had simply not shipped. 5.7.1
 * ships `src/icons` and fixes that, but the gate should not be one `files` edit
 * away from breaking again for every downstream repo at once. So: prefer src,
 * fall back to the built registry, and only fail when neither is present.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SRC_REGISTRY = resolve(here, '../../src/icons/registry.generated.ts')
const SRC_EMOJI_MAP = resolve(here, '../../src/icons/emoji-map.json')
const DIST_REGISTRY = resolve(here, '../../dist/icons/registry.generated.js')

/**
 * Icon names out of the generated .ts, without needing it compiled.
 *
 * Tolerates any indent — the emitted source is 2-space and the built .js is
 * 4-space, and a check that silently parses zero icons out of the wrong one is
 * worse than no check. `export type IconName` terminates the object in the .ts
 * and is absent from the .js, so its absence means "read to the end".
 */
function parseRegistrySource(src) {
  const start = src.indexOf('export const ICON_MARKUP')
  if (start === -1) return null
  const end = src.indexOf('export type IconName')
  const body = src.slice(start, end === -1 ? undefined : end)
  const names = [...body.matchAll(/^\s+'?([a-z0-9-]+)'?:/gm)].map(m => m[1])
  return names.length ? new Set(names) : null
}

/**
 * @returns {Promise<{iconNames: Set<string>, emojiMap: Record<string,string>|null, ambiguous: Record<string,string>|null, source: string}>}
 *   `emojiMap` is null only when neither tree carries one; `$`-prefixed comment
 *   keys are passed through untouched for the caller to skip. `ambiguous` maps an
 *   emoji to the reason its single mapping needs a human — see `$ambiguous` in
 *   emoji-map.json.
 */
export async function loadIconRegistry() {
  if (existsSync(SRC_REGISTRY)) {
    const iconNames = parseRegistrySource(readFileSync(SRC_REGISTRY, 'utf8'))
    if (iconNames) {
      const emojiMap = existsSync(SRC_EMOJI_MAP)
        ? JSON.parse(readFileSync(SRC_EMOJI_MAP, 'utf8'))
        : null
      return {
        iconNames,
        emojiMap,
        ambiguous: emojiMap?.$ambiguous ?? null,
        source: 'src/icons/registry.generated.ts',
      }
    }
  }

  if (existsSync(DIST_REGISTRY)) {
    const mod = await import(pathToFileURL(DIST_REGISTRY).href)
    if (mod.ICON_MARKUP) {
      return {
        iconNames: new Set(Object.keys(mod.ICON_MARKUP)),
        emojiMap: mod.EMOJI_TO_ICON ?? null,
        // Only the generated registry carries these in a consumer install —
        // there is no emoji-map.json outside the source tree to fall back on.
        ambiguous: mod.AMBIGUOUS_EMOJI ?? null,
        source: 'dist/icons/registry.generated.js',
      }
    }
  }

  return { iconNames: new Set(), emojiMap: null, ambiguous: null, source: null }
}

/** The message every caller should print when {@link loadIconRegistry} comes back empty. */
export const MISSING_REGISTRY_MESSAGE =
  'icon registry not found — looked for themes/src/icons/registry.generated.ts and ' +
  'themes/dist/icons/registry.generated.js.\n' +
  'In this workspace, run `pnpm run generate:icons`. From a consumer repo, this means the ' +
  'installed @wolffm/themes shipped neither tree — upgrade to >= 5.7.1.'
