/**
 * Automation preset sources (§5.4) — the lane contracts a provider publishes.
 *
 * Activating a board used to mean pasting a provider's JSON by hand, which makes
 * the human the sync mechanism: the moment TenHands changes a lane, every pasted
 * copy is stale and nobody finds out until a task lands in a lane that no longer
 * exists. So we fetch the contract from the provider instead of storing a copy.
 *
 * We fetch SERVER-side, not from the browser: the provider needn't send CORS
 * headers, a bad payload never reaches the UI (every preset is run through the
 * same `validateLaneSet` that guards activation itself), and one origin's outage
 * can't hang the modal.
 *
 * ── Caching ─────────────────────────────────────────────────────────────────
 * Presets change rarely, so we don't re-download them. Inside the TTL we serve
 * from memory with no network at all; past it we REVALIDATE with `If-None-Match`
 * /`If-Modified-Since`, so an unchanged contract costs a 304 and we keep the
 * parsed lanes we already have. If the provider is unreachable we serve the
 * cached copy anyway (flagged `stale`) — a provider outage should not empty a
 * picker the human is mid-way through using.
 *
 * ── What a provider must serve ──────────────────────────────────────────────
 * A GET returning JSON, in any of three shapes (we normalise):
 *   { "presets": [ <payload>, … ] }   ← preferred
 *   [ <payload>, … ]
 *   <payload>                          ← a single preset
 * where <payload> is exactly what activate-automation accepts:
 *   { schemaId, schemaVersion, label?, description?, lanes: [ {tag,label,order,editableBy} ] }
 * No auth, no secrets — a lane vocabulary is public information. Serving a strong
 * `ETag` is what makes the revalidation above free for you.
 */
import { validateLaneSet } from './board-automation'
import type { Lane } from '@wolffm/task/api'

/** One provider we ask for presets, from the AUTOMATION_PRESET_SOURCES binding. */
export interface PresetSource {
  id: string
  label: string
  url: string
}

/** A lane contract, normalised and validated, ready to hand to activation. */
export interface AutomationPreset {
  providerId: string
  providerLabel: string
  schemaId: string
  schemaVersion: number | null
  label: string
  description: string | null
  lanes: Lane[]
}

/** Per-source outcome, so the UI can say "TenHands is down, these are the lanes
 * we last saw" instead of showing an empty picker that reads as "none exist". */
export interface PresetSourceResult {
  id: string
  label: string
  url: string
  ok: boolean
  count: number
  /** Served from cache without a network round-trip (inside the TTL). */
  cached?: boolean
  /** Revalidated and the provider answered 304 — unchanged since we last looked. */
  notModified?: boolean
  /** Provider unreachable; this is the last good copy. */
  stale?: boolean
  error?: string
}

const FETCH_TIMEOUT_MS = 4000
/** How long a fetched contract is trusted without asking again. Past this we
 * revalidate (cheaply, via ETag) rather than discard. */
const CACHE_TTL_MS = 5 * 60 * 1000

interface CacheEntry {
  at: number
  presets: AutomationPreset[]
  etag?: string
  lastModified?: string
}

/** Keyed by URL. Survives as long as the isolate does; a cold isolate pays one
 * full fetch, every request after that is a hit or a 304. */
const cache = new Map<string, CacheEntry>()

/** http://localhost or 127.0.0.1 — a dev stub, unreachable by anyone else. */
function isLoopback(url: string): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(url)
}

/**
 * Parse the AUTOMATION_PRESET_SOURCES binding: a JSON array of {id,label,url}.
 * Absent or malformed ⇒ no sources, and the UI renders no picker at all rather
 * than an error — a deployment without providers is a valid state, not a fault.
 */
export function parsePresetSources(raw: string | undefined): PresetSource[] {
  if (!raw || !raw.trim()) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const out: PresetSource[] = []
  for (const entry of parsed) {
    const e = entry as Record<string, unknown>
    if (typeof e?.url !== 'string' || !e.url) continue
    // Refuse anything but https — a preset drives a destructive board migration,
    // so the contract can't arrive over a channel someone can rewrite in transit.
    // Loopback is exempt: it can't be intercepted, and local dev needs a stub.
    if (!e.url.startsWith('https://') && !isLoopback(e.url)) continue
    const id = typeof e.id === 'string' && e.id ? e.id : 'provider'
    out.push({ id, label: typeof e.label === 'string' && e.label ? e.label : id, url: e.url })
  }
  return out
}

/** Pull the preset payloads out of whichever of the three shapes we got. */
function unwrap(body: unknown): unknown[] {
  if (Array.isArray(body)) return body
  const obj = body as Record<string, unknown> | null
  if (obj && Array.isArray(obj.presets)) return obj.presets
  if (obj && Array.isArray(obj.lanes)) return [obj] // a single payload
  return []
}

/**
 * Normalise + validate one payload. Returns null if it isn't usable — a provider
 * shipping one broken preset shouldn't blank out its good ones.
 */
function toPreset(source: PresetSource, raw: unknown): AutomationPreset | null {
  const p = raw as Record<string, unknown>
  if (!p || typeof p !== 'object') return null
  let lanes: Lane[]
  try {
    lanes = validateLaneSet(p.lanes)
  } catch {
    return null
  }
  const schemaId = typeof p.schemaId === 'string' && p.schemaId ? p.schemaId : source.id
  const schemaVersion = typeof p.schemaVersion === 'number' ? p.schemaVersion : null
  const label =
    typeof p.label === 'string' && p.label
      ? p.label
      : `${schemaId}${schemaVersion !== null ? ` v${schemaVersion}` : ''}`
  return {
    providerId: source.id,
    providerLabel: source.label,
    schemaId,
    schemaVersion,
    label,
    description: typeof p.description === 'string' && p.description ? p.description : null,
    lanes
  }
}

const base = (s: PresetSource) => ({ id: s.id, label: s.label, url: s.url })

/**
 * Fetch one source, revalidating rather than re-downloading when we already hold
 * a copy. Never throws — an unreachable provider is a reported outcome, not a
 * 500 on our side.
 */
async function fetchSource(source: PresetSource): Promise<PresetSourceResult> {
  const hit = cache.get(source.url)
  // Fresh enough to trust without asking.
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { ...base(source), ok: true, count: hit.presets.length, cached: true }
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'hadoku-task'
  }
  // Stale but present: ask the provider whether anything actually changed.
  if (hit?.etag) headers['If-None-Match'] = hit.etag
  if (hit?.lastModified) headers['If-Modified-Since'] = hit.lastModified

  try {
    const res = await fetch(source.url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })

    // Unchanged — keep the lanes we already parsed, just extend their life.
    if (res.status === 304 && hit) {
      hit.at = Date.now()
      return { ...base(source), ok: true, count: hit.presets.length, notModified: true }
    }

    if (!res.ok) {
      if (hit) {
        return {
          ...base(source),
          ok: true,
          count: hit.presets.length,
          stale: true,
          error: `Provider returned ${res.status}; showing the last good copy`
        }
      }
      return { ...base(source), ok: false, count: 0, error: `Provider returned ${res.status}` }
    }

    const body = await res.json()
    const presets = unwrap(body)
      .map(p => toPreset(source, p))
      .filter((p): p is AutomationPreset => p !== null)

    if (presets.length === 0) {
      if (hit) {
        return {
          ...base(source),
          ok: true,
          count: hit.presets.length,
          stale: true,
          error: 'Provider served no usable lane sets; showing the last good copy'
        }
      }
      return { ...base(source), ok: false, count: 0, error: 'Provider served no usable lane sets' }
    }

    cache.set(source.url, {
      at: Date.now(),
      presets,
      etag: res.headers.get('etag') ?? undefined,
      lastModified: res.headers.get('last-modified') ?? undefined
    })
    return { ...base(source), ok: true, count: presets.length }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const reason = /timeout|abort/i.test(msg) ? 'Provider timed out' : 'Provider unreachable'
    // Serve what we have rather than emptying the picker mid-use.
    if (hit) {
      return {
        ...base(source),
        ok: true,
        count: hit.presets.length,
        stale: true,
        error: `${reason}; showing the last good copy`
      }
    }
    return { ...base(source), ok: false, count: 0, error: reason }
  }
}

/**
 * Every provider's presets, fetched in PARALLEL so a slow provider costs its own
 * latency rather than the sum. Sources are reported individually.
 */
export async function listPresets(
  rawBinding: string | undefined
): Promise<{ presets: AutomationPreset[]; sources: PresetSourceResult[] }> {
  const sources = parsePresetSources(rawBinding)
  if (sources.length === 0) return { presets: [], sources: [] }
  const results = await Promise.all(sources.map(fetchSource))
  const presets: AutomationPreset[] = []
  for (const source of sources) {
    const hit = cache.get(source.url)
    if (hit) presets.push(...hit.presets)
  }
  return { presets, sources: results }
}
