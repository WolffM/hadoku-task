/**
 * The countdown's sounds: a short tick at 3, 2 and 1, and a brighter, longer
 * "go" at 0. Synthesised with Web Audio, so there are no files to fetch and
 * nothing a slow network can delay past the beat it belongs to.
 *
 * Browsers start an AudioContext suspended until a user gesture. `unlock()` is
 * called from the Play click, which is the gesture, so the first tick sounds.
 */

let ctx: AudioContext | null = null

function context(): AudioContext | null {
  if (ctx) return ctx
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  ctx = new Ctor()
  return ctx
}

/** Call from a click handler: resumes the context so later beeps are allowed. */
export function unlockAudio(): void {
  const c = context()
  if (c && c.state === 'suspended') void c.resume()
}

function tone(freq: number, durationS: number, volume: number) {
  const c = context()
  if (!c || c.state !== 'running') return
  const t = c.currentTime
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(freq, t)
  // A fast attack and an exponential tail: a click-free blip.
  gain.gain.setValueAtTime(0.0001, t)
  gain.gain.exponentialRampToValueAtTime(volume, t + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, t + durationS)
  osc.connect(gain).connect(c.destination)
  osc.start(t)
  osc.stop(t + durationS + 0.02)
}

export function playTick(): void {
  tone(880, 0.12, 0.25)
}

export function playGo(): void {
  tone(1320, 0.45, 0.35)
}
