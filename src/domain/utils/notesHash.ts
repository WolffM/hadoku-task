/**
 * The content fingerprint behind `ifNotesHash` (autoland v3 §5.2).
 *
 * `ifCurrentLane` guards a release against a human retagging a task mid-claim.
 * With every lane `editableBy: user` there are no agent lanes left to give
 * `notes` mutual exclusion, so the same hazard moves to the plan document: an
 * agent reads it, works for twenty minutes, and releases a rewritten document
 * over the reply a human typed in the meantime. The reply is simply gone, and
 * there is no recovery path — the previous text was never stored anywhere.
 *
 * A runner cannot close that itself. Read-hash-compare-then-write is a race with
 * a window the size of the round trip; only the server can compare and write in
 * one operation. So the runner sends the hash it planned against and the server
 * refuses the write if the task no longer matches.
 *
 * ── The digest, precisely, because the other half is written in Python ───────
 *
 *   lowercase hex SHA-256 of the UTF-8 encoding of the notes,
 *   with null / absent notes hashed as the EMPTY STRING.
 *
 * No canonicalisation, no trimming, no newline normalisation: the bytes as
 * stored are the bytes hashed, because anything else is a second format both
 * sides have to agree on and drift apart over. The empty-string rule is the one
 * convention, and it is what lets a runner guard "this task had no plan when I
 * claimed it" without a nullable hash.
 *
 * Python equivalent:
 *     hashlib.sha256((notes or "").encode("utf-8")).hexdigest()
 *
 * SHA-256 rather than the FNV-1a used for the activation digest: this one
 * decides whether a human's text survives, and a 32-bit fingerprint collides at
 * a rate that turns "guarded" back into "usually guarded".
 */

/** The `ifNotesHash` digest of a task's notes. */
export async function notesHash(notes: string | null | undefined): Promise<string> {
  const bytes = new TextEncoder().encode(notes ?? '')
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Hex SHA-256 of the empty string — what absent notes hash to. Handy in tests. */
export const EMPTY_NOTES_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
