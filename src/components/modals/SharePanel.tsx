import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { Board } from '../../domain/types'
import { boardRef, type ShareApi, type ShareLevel, type ShareRow } from './shareApi'

/**
 * The per-board share panel: autocomplete a display name, pick an access level,
 * grant, and manage existing grantees. Only real, active names can be granted.
 * Exported so the toolbar's share dialog can reuse it for the current board.
 */
export function SharePanel({ board, shareApi }: { board: Board; shareApi: ShareApi }) {
  const ref = boardRef(board)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Array<{ name: string; tier?: string }>>([])
  const [picked, setPicked] = useState<{ name: string; tier?: string } | null>(null)
  const [level, setLevel] = useState<ShareLevel>('contributor')
  // Seed from the grantees GET /boards already hydrated, so the list is on
  // screen the instant the panel opens (no fetch-on-open flash / silent empty).
  const [grantees, setGrantees] = useState<ShareRow[]>(() => board.shares ?? [])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchSeq = useRef(0)

  // Re-read the grantee list from the server (after a grant/revoke). The client's
  // listShares reports EVERY failure as an empty array, so an empty reply is
  // ambiguous — never let one blank out a list we already have, or a transient
  // hiccup reads as "shared with nobody". An add/remove we just made is reflected
  // by the caller updating state directly.
  const refresh = useCallback(() => {
    void shareApi.listShares(ref).then(rows => {
      setGrantees(prev => (rows.length === 0 && prev.length > 0 ? prev : rows))
    })
  }, [shareApi, ref])

  // Grantees normally arrive hydrated on the board (GET /boards). Only fetch when
  // they didn't — an older payload, or a board the hydration skipped.
  useEffect(() => {
    if (board.shares === undefined) refresh()
  }, [refresh, board.shares])

  // Keep in step if a board reload brings a fresh grantee list.
  useEffect(() => {
    if (board.shares) setGrantees(board.shares)
  }, [board.shares])

  // Debounced autocomplete. A pick sets query to the picked name; typing again
  // re-opens. A sequence guard drops out-of-order responses (the search scan can
  // be slow), so a stale slow reply never clobbers the latest results.
  useEffect(() => {
    const q = query.trim()
    // Don't re-search the exact text we just picked.
    if (picked && picked.name === q) return
    if (debounce.current) clearTimeout(debounce.current)
    if (!q) {
      setResults([])
      return
    }
    const mySeq = ++searchSeq.current
    debounce.current = setTimeout(() => {
      void shareApi.searchUsers(q).then(users => {
        if (mySeq === searchSeq.current) setResults(users)
      })
    }, 250)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [query, picked, shareApi])

  // The grantee is a click-picked result, OR an exact (case-insensitive) match
  // for the typed text — so typing the full name and hitting Share also works,
  // without needing a precise click on the dropdown.
  const qLower = query.trim().toLowerCase()
  const effectivePick = picked ?? results.find(u => u.name.toLowerCase() === qLower) ?? null

  const grant = () => {
    if (!effectivePick || busy) return
    const target = effectivePick
    setBusy(true)
    setMsg(null)
    void shareApi
      .grantShare(ref, { name: target.name, level })
      .then(res => {
        if (res.ok) {
          setMsg({
            kind: 'ok',
            text: `Shared with ${res.granted?.name ?? target.name} (${res.granted?.tier ?? '—'})`
          })
          setQuery('')
          setPicked(null)
          setResults([])
          refresh()
        } else {
          setMsg({ kind: 'err', text: res.error ?? 'Could not share' })
        }
      })
      .finally(() => setBusy(false))
  }

  const revoke = (g: ShareRow) => {
    if (busy) return
    setBusy(true)
    void shareApi
      .revokeShare(ref, g.granteeUserId)
      .then(ok => {
        if (!ok) return
        // Drop the row locally: revoking the LAST grantee legitimately yields an
        // empty list, which refresh()'s guard would otherwise mistake for a
        // failed fetch and keep showing the person we just removed.
        setGrantees(prev => prev.filter(x => x.granteeUserId !== g.granteeUserId))
        refresh()
      })
      .finally(() => setBusy(false))
  }

  return (
    <div className="share-panel">
      <div className="share-panel__grant">
        <div className="share-panel__search">
          <input
            className="share-panel__input"
            type="text"
            placeholder="Share with… (type a display name)"
            value={query}
            onChange={e => {
              setQuery(e.target.value)
              setPicked(null)
            }}
            aria-label="Grantee display name"
          />
        </div>

        <select
          className="share-panel__level"
          value={level}
          onChange={e => setLevel(e.target.value as ShareLevel)}
          aria-label="Access level"
        >
          <option value="contributor">Contributor</option>
          <option value="readonly">Read-only</option>
        </select>

        <button
          className="share-panel__grant-btn"
          onClick={grant}
          disabled={!effectivePick || busy}
          title={
            effectivePick ? `Share with ${effectivePick.name}` : 'Pick a real display name first'
          }
        >
          Share
        </button>
      </div>

      {results.length > 0 && !picked && (
        <ul className="share-panel__results" role="listbox">
          {results.map(u => (
            <li key={u.name}>
              <button
                type="button"
                className="share-panel__result"
                onClick={() => {
                  setPicked(u)
                  setQuery(u.name)
                  setResults([])
                }}
              >
                <span className="share-panel__result-name">{u.name}</span>
                {u.tier && <span className="share-panel__result-tier">{u.tier}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {msg && <p className={`share-panel__msg is-${msg.kind}`}>{msg.text}</p>}

      {grantees.length > 0 && (
        <ul className="share-panel__grantees">
          {grantees.map(g => (
            <li key={g.granteeUserId} className="share-panel__grantee">
              <span className="share-panel__grantee-name">
                {g.name ?? `${g.granteeUserId.slice(0, 8)}…`}
                {g.tier && <span className="share-panel__grantee-tier">{g.tier}</span>}
              </span>
              <span className="share-panel__grantee-level">{g.level}</span>
              <button
                className="share-panel__revoke"
                onClick={() => revoke(g)}
                disabled={busy}
                title={`Revoke ${g.name ?? 'access'}`}
                aria-label={`Revoke ${g.name ?? g.granteeUserId}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
