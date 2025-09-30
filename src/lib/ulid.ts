// Minimal ULID-like id (not fully spec compliant, sufficient for single-user)
export function ulid(): string {
  const t = Date.now().toString(36).toUpperCase().padStart(8,'0')
  const r = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => (b % 36).toString(36).toUpperCase()).join('')
  return t + r.slice(0, 18)
}
