# Local Desktop Integration — Design Doc

Status: **Planning / approved direction.** No implementation yet.
Date: 2026-06-05
Scope: Add local KDE desktop surfaces (Kate editor tabs + Plasma calendar) on top of the
existing hosted `@wolffm/task` app. **Purely additive** — the hosted web app and its API
must keep working exactly as-is.

---

## 1. Locked decisions (recap)

| Area              | Decision                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source of truth   | Cloudflare KV, unchanged. Keys `boards:{cred}` / `tasks:{cred}:{boardId}`. Reuse `src/domain/types.ts` as the contract.                                                                                                                                                                                                                                                                                                      |
| Data model        | `Task` (title + tag + state + timestamps + `startTime`/`endTime`). MVP = **no new body/notes field**.                                                                                                                                                                                                                                                                                                                        |
| Editor surface    | **Native Kate `KTextEditor::Plugin` (C++/CMake)** — two tool-view tabs: **Tasks** + **Calendar**. KWrite cannot host plugins (sessions/plugins disabled by design); the tabs require Kate.                                                                                                                                                                                                                                   |
| Plugin UI toolkit | **QML / Kirigami**, embedded in the C++ tool view via `QQuickWidget`. `QWebEngineView`/React rejected (embedded Chromium). Calendar is the centerpiece → Kirigami's native look + calendar views win; cost is the Qt Quick runtime (modest, native). **Embedding mechanics are a Phase-1 spike, not yet proven — see §3/§8.**                                                                                                |
| Repo location     | **`plugins/kate/` subfolder** of this repo (not a separate repo). Invisible to pnpm (explicit workspace globs); own CMake build + own CI workflow. Drift guard = **hand-written `Task`/`Board` structs + a CI parity test** vs `openapi.json` (codegen deferred — overkill for 2 types).                                                                                                                                     |
| Distribution      | **Local install** (`cmake --install`). Verified plugin dir (Debian 13 multiarch): system `/usr/lib/x86_64-linux-gnu/qt6/plugins/kf6/ktexteditor/`; user `~/.local/lib/x86_64-linux-gnu/qt6/plugins/kf6/ktexteditor/` (NOT `lib64`). `.so` + embedded `plugin.json`; QML via `.qrc` into the `.so`. CI builds/compile-checks only; Flatpak deferred.                                                                          |
| Auth              | Replicate the browser cookie model: enter key **once** → `POST /session/create` → opaque session id → store in **KWallet** → send `X-Session-Id` on every later call. Direct to `hadoku.me/task/api/*`. **No central daemon.** Session = **30-day sliding TTL** (re-minted <7d remaining; no refresh endpoint) so `401` is rare; cache the **raw key in KWallet too** for silent re-mint on `401` (vs a ~monthly re-prompt). |
| Secret storage    | **KWallet** = local store for the session token. **Vaultwarden** = personal cross-device source of truth for the _raw key_ (seeded manually at setup; not a runtime dependency).                                                                                                                                                                                                                                             |
| Data partition    | Plugin uses **your own user-key**, so its session resolves to the same credential the website cookie does → **same tasks**, both directions. (A separate service key would be a different, empty partition.)                                                                                                                                                                                                                 |
| Write safety      | **L1 + L2 optimistic concurrency**: board carries a `version`; writes present `If-Match`; mismatch → `409`, client re-pulls + retries. Backward-compatible (no `If-Match` ⇒ legacy last-write-wins). **Narrows lost-update, doesn't eliminate it** — KV is eventually consistent, so even the server's `version` read can be stale (brief false-`409`→re-pull loop possible). True CAS = Durable Object (deferred; see §4).  |
| Surfaces          | Kate Tasks + Calendar tabs **and** the Plasma desktop calendar widget.                                                                                                                                                                                                                                                                                                                                                       |

---

## 2. Architecture & data flow

```
                       ┌──────────────────────────────────────────┐
                       │              hadoku.me (edge)             │
   browser ── cookie ─▶│  edge-router  ── resolves cred ─▶ stamps  │
                       │   /session/create  /session/whoami        │
   Kate plugin ──┐     │   X-User-Key | X-Session-Id | Bearer      │
   (X-Session-Id)│────▶│            ──── X-Edge-Auth ────▶         │
   capture watch │     │                              task worker  │
   (X-Session-Id)│     │                 (Hono+Zod) ─▶ KV (truth)  │
                 │     └──────────────────────────────────────────┘
                 │
   local box ────┘
   ┌───────────────────────────────────────────────────────────┐
   │ Kate (KTextEditor plugin)                                   │
   │   ┌─────────────┐   ┌──────────────┐   reads token         │
   │   │ Tasks view  │   │ Calendar view│◀────────────┐         │
   │   └──────┬──────┘   └──────┬───────┘             │         │
   │          └────────┬────────┘            ┌────────┴───────┐ │
   │              TaskStore (model)──────────▶│ SessionManager │ │
   │                    │                     │  (KWallet)     │ │
   │              TaskApiClient (Qt net) ─────┴──────▶ edge     │
   │              SyncController (poll/push, 409 retry)         │
   └───────────────────────────────────────────────────────────┘
                 │ (optional, "full" build)
   ┌─────────────┴───────────┐   ┌──────────────────────────────┐
   │ capture watcher          │   │ Plasma desktop calendar       │
   │ (~/notes file → tasks)   │   │  ICS feed → Akonadi/KOrganizer│
   └──────────────────────────┘   └──────────────────────────────┘
```

---

## 3. Shape of the C++ plugin (modules)

Standard two-class KTextEditor plugin skeleton (copy structure from a bundled Kate addon),
plus our own modules. UI is **QML/Kirigami hosted in a `QQuickWidget`** inside each tool view
(no `Kirigami.ApplicationWindow` — the host window is Kate's); QML shipped via `.qrc`; style pinned
with `QQuickStyle::setStyle("org.kde.desktop")` to match Kate. No WebEngine.

> ⚠️ **Unproven — Phase-1 spike required (see §8).** No Kate plugin precedent embeds QML; this
> composes `createToolView` + `QQuickWidget`. Caveats that bite here: QQuickWidget draws before
> non-OpenGL widgets (stacking → may need `WA_AlwaysStackOnTop`) and **disables the threaded render
> loop** (can dull the Kirigami animations we chose it for). The spike must also pick the mechanism —
> `QQuickWidget` (better focus/stacking, no threaded render) vs `createWindowContainer`+`QQuickView`
> (threaded render, worse focus) — and verify focus in/out, typing, HiDPI, and render flush before
> `TaskStore` is built on it.

| Module             | Type / base                         | Responsibility                                                                                                                                                                                                                                                                              |
| ------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TaskPlugin`       | `KTextEditor::Plugin`               | Entry point + `plugin.json` metadata; one global instance; `createView()`.                                                                                                                                                                                                                  |
| `TaskPluginView`   | `QObject`, `KXMLGUIClient`          | Per-MainWindow; creates the two tool views via `createToolView(...)`; registers actions/shortcuts.                                                                                                                                                                                          |
| `SessionManager`   | `QObject`                           | First-run key prompt → `POST /session/create`; store session id **and raw key** in **KWallet**; attach `X-Session-Id`; on `401` silently re-mint from the stored key (re-prompt only if that also fails).                                                                                   |
| `TaskApiClient`    | `QObject` (`QNetworkAccessManager`) | Thin typed wrapper over REST (`/tasks`, `POST /`, `PATCH /{id}`, `/{id}/complete`, `DELETE /{id}`, `/stats`, boards). Holds board `version`; sends `If-Match`; on `409` → refetch + retry.                                                                                                  |
| `domain` (structs) | plain C++/JSON                      | **Hand-written** mirror of `src/domain/types.ts` (`Task`, `Board`) + a CI parity test vs `openapi.json` for drift (codegen deferred — only 2 types).                                                                                                                                        |
| `TaskStore`        | `QAbstractItemModel`                | In-memory model backing both views; current board + version; change signals; optional on-disk cache for offline _viewing_.                                                                                                                                                                  |
| `TasksToolView`    | `QQuickWidget` + QML                | Kirigami list of tasks; **quick-add input (capture)**; complete/delete/tag actions; tag filter. Bound to `TaskStore`.                                                                                                                                                                       |
| `CalendarToolView` | `QQuickWidget` + QML                | Kirigami day/timeline of tasks with `startTime`/`endTime`; create-from-timeslot; drag-to-reschedule (mirrors web `CalendarDayView`). From-scratch Kirigami over `TaskStore`; Merkuro = UX reference only (its views bind to Akonadi's model, not reusable). **Highest-variance line item.** |
| `SyncController`   | `QObject`                           | Pull on a timer + on focus; push on edit; L1 staleness + L2 version-conflict handling; (full build) offline write queue.                                                                                                                                                                    |
| `TaskConfigPage`   | `KTextEditor::ConfigPage`           | Settings: server base URL, poll interval, default board, re-auth/sign-out.                                                                                                                                                                                                                  |

---

## 4. Server-side work (this repo) — L1 + L2 concurrency

Additive changes only; legacy clients keep last-write-wins.

1. Add monotonic `version: number` (and `lastActionAt`) to `TasksFile` (the board blob).
2. `GET /tasks` returns the version (response body field + `ETag` header).
3. Mutations (`POST /`, `PATCH`, `complete`, `DELETE`, batch) accept `If-Match: <version>`:
   - present + matches → apply, bump version, return new version;
   - present + stale → `409 Conflict` (+ current version) so client re-pulls/retries;
   - **absent → current behavior** (backward-compatible; hosted web app unaffected).
4. Keep the existing in-memory per-instance `withBoardLock`. **Honest framing: this narrows lost
   updates, it does not eliminate them** — KV is eventually consistent, so the server's read of
   `version` at write time can itself be stale (it may accept a write it should `409`, or `409` one
   it shouldn't; the false-`409` self-heals via re-pull, though a re-pull can also read stale → a
   brief loop). Acceptable for a single user rarely writing from two colos in the same window.
   **Escape hatch (not now):** for true compare-and-swap, move the board to a Cloudflare **Durable
   Object** (atomic, strongly consistent) instead of KV — overkill for single-user, but the
   documented exit if multi-writer correctness is ever needed.
5. (Later, optional) migrate the web client (`useTasks`) to send `If-Match` too, so the website
   benefits from the same guard.

---

## 5. Plasma desktop calendar surface

This surface is **independent of Phases 1–3** (it doesn't need the plugin), so it's the cheapest
user-visible win and can be pulled forward.

- **MVP (recommended): local `.ics` file.** A small periodic writer (a systemd **user timer**, not a
  persistent daemon) pulls scheduled tasks and writes `~/.local/share/.../tasks.ics`; add it to
  KOrganizer/Akonadi as a **local ICS file** resource → the Plasma calendar applet renders the
  events. Sidesteps network auth entirely (Akonadi just reads a file).
- **Avoid: network ICS feed.** A stock Akonadi ICS-from-URL resource can't inject an `X-Session-Id`
  header → forces an unauthenticated feed or a `?token=` URL, both worse than the local file.
- **Verify/install:** the applet's PIM **event plugin** (from `kdepim-addons`) — currently only
  `holidayevents` is present on this box.
- **Full (later):** custom **Plasmoid (QML)** reading tasks directly from the API/local store. More
  control, more work, not gated on Akonadi.

---

## 6. Capture flow

- **MVP:** capture happens **in the Tasks tab** — quick-add input, Enter → `POST /` task. Replaces
  the Super→note→file flow for task entry.
- **Full (optional):** preserve the muscle-memory file flow — a small **watcher** on a scratch file
  (`~/notes/…`); lines with task syntax sync as tasks. This watcher is the _only_ remaining
  background process, and it is itself just another direct `hadoku.me` client (same auth).
- **Open:** task **notes/body** would need an additive `Task.notes?` field (domain type + worker).
  Deferred for MVP.

---

## 7. Phased plan + Definition of Done

### Phase 0 — API hardening (server, this repo) ✅ DONE (2026-06-06)

Add board `version` + `If-Match`/`409`; backward-compatible. Also fix two bugs found during live
verification: (a) `POST /task/api/` with a **trailing slash** → 404 (only `/task/api` matches);
(b) `DELETE`/`PATCH` on a **non-existent or non-active** task → `500` instead of `404` (and not
idempotent). Plugin client must avoid the trailing slash regardless, and **treat `404`/already-deleted
on DELETE as success** — delete idempotency is load-bearing for `SyncController` retries after a blip.

**Implemented:**

- `TasksFile.version` widened `1`→`number` (`src/domain/types.ts`); added `VersionConflictError`
  (HTTP 409, carries `currentVersion`), exported from `@wolffm/task/api`.
- `withTaskOperation` (`handlers-utils.ts`) is the single read-modify-write chokepoint: optional
  `expectedVersion` → L2 check (throws `VersionConflictError` on mismatch); **bumps `version` on
  every write**; injects the new `version` into object results. Threaded `expectedVersion` through
  `createTask`/`updateTask`/`completeTask`/`deleteTask`.
- Worker: global `onError` now maps any `DomainError` (`httpStatus`+`code`, detected structurally)
  to its status before the generic 500 — fixes 404-vs-500 across task/board/tag routes at once.
- `GET /tasks` returns `version` (body) + `ETag`; mutations return new `version` (body) + `ETag`.
  Routes parse `If-Match` (`parseIfMatch`, accepts `3` or `"3"`, `*`/absent ⇒ legacy LWW).
- Schemas updated (additive optional `version`).
- **Bug (a) trailing slash:** edge/Hono routing artifact, not a clean server fix (would need a
  shadow route). Resolution = client never sends the trailing slash (`TaskApiClient` contract).

**Verified (runtime, not just typecheck):** in-process harness boots the real `createTaskHandler()`
and drives `app.request()` against in-memory KV + stub D1 — **25/25 checks pass**: missing
delete/patch/complete → `404` (`TASK_NOT_FOUND`), not `500`; GET version+ETag; version bump per
write; stale `If-Match` → `409` + `currentVersion` (and the write is _not_ applied); correct
`If-Match` applies; **no `If-Match` still succeeds** (backward-compat). Harness at
`worker/test/phase0-verify.ts` (bundle w/ esbuild aliasing `@wolffm/task/api`→`dist/server`, run
w/ node — not wired into CI). Root app typecheck clean; worker bundles; lint+format clean.
Deploys via the normal CI publish (this repo ships the package; hadoku_site consumes it).

**DoD:** ✅ new field present; ✅ `If-Match` mismatch → `409`; ✅ absent `If-Match` → unchanged;
trailing-slash → documented as client-avoided; ✅ delete-missing → `404`. ⏳ existing Playwright e2e
(run vite against **prod**, so they validate the frontend, not these not-yet-deployed server
changes) — orthogonal; rerun on next publish.

### Phase 1 — Plugin skeleton + auth (MVP core)

**Scaffold landed (2026-06-06):** `plugins/kate/` holds the buildable skeleton — `CMakeLists.txt`
(KF6/Qt6, installs via `qtpaths6 --plugin-dir` to `…/qt6/plugins/kf6/ktexteditor/`), the two-class
plugin (`TaskPlugin` + `TaskPluginView`), embedded `taskplugin.json`, `qml/SpikeView.qml`, and CI
(`.github/workflows/kate-plugin.yml`, `debian:trixie` container — compile-check only).
`publish.yml` path-ignores `plugins/**`/`docs/**`.

**Spike PASSED ✅ (2026-06-06) — `QQuickWidget` retained.** The Kirigami-in-tool-view embedding
works in real Kate: plugin loads, both tabs appear, the scene renders with the `org.kde.desktop`
style, and a button click round-trips (mouse input → JS handler → property update). Confirmed two
ways: a live click in Kate (`"clicked at …"`) and an offscreen render of the **installed** `.so`
(deps resolve, embedded `qrc` intact, layout correct). **Gotcha found & fixed:** QML `i18n()` is
undefined unless `KLocalization::setupLocalizedContext(engine)` is called before `setSource` — without
it every text binding throws `ReferenceError` and renders blank. `createWindowContainer` not needed.
Remaining subjective check (low risk): keyboard focus/typing feel on tab in/out.
Then: KTextEditor plugin loads in Kate; empty Tasks tab; `SessionManager` (key → `/session/create` →
KWallet → `X-Session-Id`).
**DoD:** embedded Kirigami spike passes (clean focus in/out + typing); plugin builds via CMake and
appears as a tool-view tab; first-run key prompt mints + caches a session; session **survives Kate
restart**; `whoami` confirms identity.

### Phase 2 — Tasks tab (read/write CRUD)

`TaskApiClient` + `TaskStore` + `TasksToolView`: list, quick-add, complete, delete, tag filter, with
`If-Match`/`409` handling.
**DoD:** create/complete/delete in Kate appears on the website and vice-versa (**same partition**);
a stale plugin write returns `409` and recovers via re-pull (no silent clobber).

### Phase 3 — Calendar tab

`CalendarToolView`: day/timeline of scheduled tasks; create-from-timeslot; drag-to-reschedule.
**DoD:** tasks with `startTime`/`endTime` render on a timeline; create + reschedule round-trip to API
and match the web calendar.

### Phase 4 — Plasma desktop calendar

Local `.ics` writer (user timer) → Akonadi local-file resource → Plasma applet (install PIM event
plugin). **Independent of Phases 1–3 — can be pulled forward as an early win.**
**DoD:** a scheduled task shows in the desktop calendar popup within one sync cycle.

### Phase 5 (optional, "full") — file capture + offline

Scratch-file watcher; offline view cache + write queue/reconcile.
**DoD:** task syntax in the watched file syncs; edits made offline replay on reconnect without loss.

**MVP = Phases 0–3.** Full = + 4, 5.

---

## 8. Left to verify / decide

**Verified ✅**

- Build toolchain present on Debian 13 (ECM 6.13, `libkf6texteditor-dev` 6.13, kf6 coreaddons/i18n/
  xmlgui, **`libkf6wallet-dev` 6.13**, qt6-base, qt6-networkauth). KWallet6 + PAM auto-unlock installed.
- Plasma PIM stack present (`korganizer`, `akonadictl`).
- **Auth chain proven live (2026-06-06)** with a real `friend` key: `validate-key` → `valid:true`;
  `POST /session/create` → `200` returns 32-char `sessionId`; both `X-Session-Id` and `X-User-Key`
  resolve to the same partition. Dev credential = vault `TASK_FRIEND_TEST_KEY` (ACL-granted).
- **Full CRUD proven live:** create / patch-schedule (`startTime`/`endTime` persist) / complete /
  delete(active) all `200`. The plugin can drive the real API today.

**To verify 🔍**

- ~~#1 RISK — QML/Kirigami in a `QQuickWidget` tool view.~~ **RESOLVED — spike passed (see Phase 1).**
  `QQuickWidget` retained; render + mouse input confirmed in real Kate. Only keyboard focus/typing
  _feel_ left to judge subjectively (low risk).
- Plasma calendar PIM **event plugin** (`kdepim-addons`) — only `holidayevents` found; needed for §5 MVP.

**Decided ✅**

- UI toolkit: **QML/Kirigami**, embedded via **`QQuickWidget`** (spike-confirmed; `createWindowContainer`
  not needed). Repo: **`plugins/kate/`** subfolder; local-install distribution; hand-written types +
  CI parity test. **QML i18n requires `KLocalization::setupLocalizedContext(engine)` before `setSource`.**

**To decide 🟡**

- Task **notes/body** field — defer (recommended) vs add now.
- Plasma calendar: ICS→Akonadi (MVP) vs custom plasmoid (full).

**Non-negotiable constraint**

- Server changes stay backward-compatible; hosted web app + API behavior unchanged (guarded by
  existing Playwright e2e).
