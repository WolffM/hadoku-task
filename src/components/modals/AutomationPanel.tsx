import React, { useEffect, useState } from 'react'
import type { Board, AutomationPreset, PresetSourceStatus, PresetUpdate } from '../../domain/types'
import { boardRef, type ShareApi } from './shareApi'

/**
 * Convert a board to (or off) an automation board (§5.4). Activation is a
 * DESTRUCTIVE migration: pick a provider's published lane contract (or paste
 * one) and it commits immediately — there is no separate preview-then-confirm
 * step. An automation board shows its lanes + a Deactivate action.
 */
export function AutomationPanel({
  board,
  shareApi,
  onDone
}: {
  board: Board
  shareApi: ShareApi
  onDone: () => Promise<void>
}) {
  const ref = boardRef(board)
  const isAutomation = board.mode === 'automation'
  const [raw, setRaw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [presets, setPresets] = useState<AutomationPreset[] | null>(null)
  const [presetSources, setPresetSources] = useState<PresetSourceStatus[]>([])
  const [chosen, setChosen] = useState<string | null>(null)
  const [presetUpdate, setPresetUpdate] = useState<PresetUpdate | null>(null)

  const showConvert = !isAutomation

  // Load the providers' live lane contracts once, when the convert view opens.
  // shareApi is memoized upstream, so this doesn't re-fire per render.
  useEffect(() => {
    if (!showConvert) return
    let cancelled = false
    void shareApi.listAutomationPresets().then(res => {
      if (cancelled) return
      setPresets(res.presets)
      setPresetSources(res.sources)
    })
    return () => {
      cancelled = true
    }
  }, [showConvert, shareApi])

  // Has the provider published past what this board was activated from? The
  // worker answers from its own cached copy of the contract, so this is a cheap
  // read — and a null answer (including a cold cache) simply shows nothing.
  useEffect(() => {
    if (!isAutomation) return
    let cancelled = false
    void shareApi.getPresetUpdate(ref).then(u => {
      if (!cancelled) setPresetUpdate(u)
    })
    return () => {
      cancelled = true
    }
  }, [isAutomation, ref, shareApi])

  /** Commit an activation payload straight away. Picking a preset and pasting
   * JSON both land here — there is no dry-run gate in between; the digest echo
   * that guards a commit is optional, so omitting it just applies the payload. */
  const activate = (payload: {
    lanes: unknown
    schemaId?: string
    schemaVersion?: number
    repo?: string
  }) => {
    setBusy(true)
    setErr(null)
    void shareApi
      .activateAutomation(ref, payload)
      .then(async res => {
        if (res.ok) await onDone()
        else setErr(res.error ?? 'Activation failed')
      })
      .finally(() => setBusy(false))
  }

  /** Fetch the newer contract and apply it immediately — reactivation is the
   * same one-click commit as a first-time activation. */
  const startReactivate = () => {
    if (!presetUpdate) return
    setErr(null)
    setBusy(true)
    void shareApi.listAutomationPresets().then(res => {
      const p = res.presets.find(x => x.schemaId === presetUpdate.schemaId)
      if (!p) {
        setErr('That contract is no longer being served by the provider.')
        setBusy(false)
        return
      }
      setPresets(res.presets)
      setPresetSources(res.sources)
      choosePreset(p)
    })
  }

  /** Selecting a preset fills the JSON box for reference and commits it right
   * away — no separate preview/confirm click. */
  const choosePreset = (p: AutomationPreset) => {
    const key = `${p.providerId}:${p.schemaId}:${p.schemaVersion ?? '-'}`
    setChosen(key)
    setErr(null)
    setRaw(
      JSON.stringify(
        {
          schemaId: p.schemaId,
          ...(p.schemaVersion !== null ? { schemaVersion: p.schemaVersion } : {}),
          lanes: p.lanes
        },
        null,
        2
      )
    )
    activate({
      lanes: p.lanes,
      schemaId: p.schemaId,
      schemaVersion: p.schemaVersion ?? undefined,
      repo: repo.trim() || undefined
    })
  }
  const [repo, setRepo] = useState((board.repo as string | undefined) ?? '')
  const [repoStatus, setRepoStatus] = useState<{
    valid: boolean
    private?: boolean
    defaultBranch?: string
    message?: string
  } | null>(null)
  const [repoChecking, setRepoChecking] = useState(false)

  // Validate against GitHub, then AUTO-SAVE on success — no separate button.
  // Clearing the field (empty on blur) clears the saved repo.
  const checkRepo = () => {
    const r = repo.trim()
    setRepoStatus(null)
    if (!r) {
      if ((board.repo as string | undefined) ?? '') void shareApi.setRepo(ref, '')
      return
    }
    setRepoChecking(true)
    void shareApi
      .validateRepo(r)
      .then(res => {
        setRepoStatus(res)
        if (res.valid) void shareApi.setRepo(ref, r)
      })
      .finally(() => setRepoChecking(false))
  }

  // Parse the pasted JSON into an activation payload (lanes + opaque labels + repo).
  const parsePayload = (): {
    lanes: unknown
    schemaId?: string
    schemaVersion?: number
    repo?: string
  } | null => {
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>
      const lanes = Array.isArray(obj.lanes) ? obj.lanes : Array.isArray(obj) ? obj : null
      if (!lanes) {
        setErr('JSON must have a `lanes` array (or be a lane array).')
        return null
      }
      return {
        lanes,
        schemaId: typeof obj.schemaId === 'string' ? obj.schemaId : undefined,
        schemaVersion: typeof obj.schemaVersion === 'number' ? obj.schemaVersion : undefined,
        repo: typeof obj.repo === 'string' ? obj.repo : undefined
      }
    } catch {
      setErr('That is not valid JSON.')
      return null
    }
  }

  /** Commit whatever is in the paste box — the manual-entry counterpart to
   * choosePreset. There's no preset "click" to hang the commit off, so this
   * stays an explicit button, but it's a single click, not preview-then-commit. */
  const applyManual = () => {
    const payload = parsePayload()
    if (!payload) return
    activate(payload)
  }

  const deactivate = () => {
    if (
      !window.confirm(
        `Deactivate automation on "${board.name}"? Tasks keep their tags; the lane lock is removed.`
      )
    )
      return
    setBusy(true)
    setErr(null)
    void shareApi
      .deactivateAutomation(ref)
      .then(async res => {
        if (res.ok) await onDone()
        else setErr(res.error ?? 'Deactivation failed')
      })
      .finally(() => setBusy(false))
  }

  // The repo field is shared by both views. It validates against GitHub on blur
  // and AUTO-SAVES on success (repo drives the board → checkout mapping, §5.5).
  const repoField = (
    <div className="automation-panel__repo">
      <input
        className="automation-panel__repo-input"
        type="text"
        placeholder="Repo (owner/name), e.g. WolffM/my-repo"
        value={repo}
        onChange={e => {
          setRepo(e.target.value)
          setRepoStatus(null)
        }}
        onBlur={checkRepo}
        onKeyDown={e => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        aria-label="Repo"
      />
      {repoChecking && <span className="automation-panel__repo-status is-checking">checking…</span>}
      {!repoChecking && repoStatus?.valid && (
        <span className="automation-panel__repo-status is-ok">
          ✓ saved · {repoStatus.private ? 'private' : 'public'}
          {repoStatus.defaultBranch ? ` · ${repoStatus.defaultBranch}` : ''}
        </span>
      )}
      {!repoChecking && repoStatus && !repoStatus.valid && (
        <span className="automation-panel__repo-status is-bad" title={repoStatus.message}>
          ✗ {repoStatus.message ?? 'not found'}
        </span>
      )}
    </div>
  )

  if (!showConvert) {
    const lanes = (board.lanes ?? []) as Array<{ tag: string; label?: string; editableBy?: string }>
    return (
      <div className="share-panel automation-panel">
        <p className="automation-panel__status">
          <strong>Automation active</strong>
          {board.schemaId ? ` · ${board.schemaId} v${board.schemaVersion ?? '?'}` : ''} ·{' '}
          {lanes.length} lanes
        </p>

        {presetUpdate && (
          <div
            className={`automation-panel__update${presetUpdate.safe ? '' : ' is-unsafe'}`}
            role="status"
          >
            <span className="automation-panel__update-text">
              <strong>
                {presetUpdate.providerLabel} published v{presetUpdate.schemaVersion}
              </strong>
              {' · '}
              {presetUpdate.safe
                ? 'no task moves'
                : `${presetUpdate.toInbox} task${presetUpdate.toInbox === 1 ? '' : 's'} would move to the Inbox`}
            </span>
            <button
              type="button"
              className="automation-panel__update-btn"
              onClick={startReactivate}
              disabled={busy}
            >
              Apply update
            </button>
          </div>
        )}

        {repoField}

        <ul className="automation-panel__lanes">
          {lanes.map(l => (
            <li key={l.tag} className="automation-panel__lane">
              <span className="automation-panel__lane-tag">{l.label ?? l.tag}</span>
              <span className={`automation-panel__lane-by is-${l.editableBy}`}>{l.editableBy}</span>
            </li>
          ))}
        </ul>
        {err && <p className="share-panel__msg is-err">{err}</p>}
        <button className="automation-panel__deactivate" onClick={deactivate} disabled={busy}>
          Deactivate automation
        </button>
      </div>
    )
  }

  return (
    <div className="share-panel automation-panel">
      <p className="automation-panel__hint">
        Convert this to an <strong>automation board</strong>: pick a provider&apos;s lane contract
        below and it applies immediately, or paste one and click Activate. This is{' '}
        <strong>destructive</strong> — it replaces the board&apos;s tags with the fixed lanes, and
        any task whose tag isn&apos;t one of them is cleared to the Inbox.
      </p>
      {repoField}

      {presets === null && <p className="automation-panel__presets-msg">Loading presets…</p>}

      {presets !== null && presets.length > 0 && (
        <ul className="automation-panel__presets">
          {presets.map(p => {
            const key = `${p.providerId}:${p.schemaId}:${p.schemaVersion ?? '-'}`
            const agentLanes = p.lanes.filter(l => l.editableBy === 'agent').length
            return (
              <li key={key}>
                <button
                  type="button"
                  className={`automation-panel__preset${chosen === key ? ' is-chosen' : ''}`}
                  onClick={() => choosePreset(p)}
                  title={p.description ?? undefined}
                  aria-pressed={chosen === key}
                  disabled={busy}
                >
                  <span className="automation-panel__preset-label">{p.label}</span>
                  <span className="automation-panel__preset-meta">
                    {p.providerLabel} · {p.schemaId}
                    {p.schemaVersion !== null ? ` v${p.schemaVersion}` : ''} · {p.lanes.length}{' '}
                    lanes
                    {agentLanes > 0 ? ` (${agentLanes} agent)` : ''}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {/* An empty picker reads as "no presets exist", so say which provider failed. */}
      {presetSources
        .filter(s => s.error)
        .map(s => (
          <p key={s.id} className="automation-panel__presets-msg is-warn">
            {s.label}: {s.error}
          </p>
        ))}

      {presets !== null && presets.length === 0 && presetSources.length === 0 && (
        <p className="automation-panel__presets-msg">
          No preset providers configured — paste a lane contract below.
        </p>
      )}

      <textarea
        className="automation-panel__json"
        placeholder={'{\n  "schemaId": "autoland",\n  "schemaVersion": 1,\n  "lanes": [ … ]\n}'}
        value={raw}
        onChange={e => {
          setRaw(e.target.value)
          setChosen(null)
          setErr(null)
        }}
        rows={4}
        aria-label="Activation JSON"
      />

      {err && <p className="share-panel__msg is-err">{err}</p>}

      <div className="automation-panel__actions">
        <button
          className="automation-panel__activate-btn"
          onClick={applyManual}
          disabled={busy || !raw.trim()}
          title="Activate (destructive)"
        >
          Activate
        </button>
      </div>
    </div>
  )
}
