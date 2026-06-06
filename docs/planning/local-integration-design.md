# Local Desktop Integration — Design Doc

Status: **Planning / approved direction.** No implementation yet.
Date: 2026-06-05
Scope: Add local KDE desktop surfaces (Kate editor tabs + Plasma calendar) on top of the
existing hosted `@wolffm/task` app. **Purely additive** — the hosted web app and its API
must keep working exactly as-is.

---

## 1. Locked decisions (recap)

| Area              | Decision                                                                                                                                                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source of truth   | Cloudflare KV, unchanged. Keys `boards:{cred}` / `tasks:{cred}:{boardId}`. Reuse `src/domain/types.ts` as the contract.                                                                                                                              |
| Data model        | `Task` (title + tag + state + timestamps + `startTime`/`endTime`). MVP = **no new body/notes field**.                                                                                                                                                |
| Editor surface    | **Native Kate `KTextEditor::Plugin` (C++/CMake)** — two tool-view tabs: **Tasks** + **Calendar**. KWrite cannot host plugins (sessions/plugins disabled by design); the tabs require Kate.                                                           |
| Plugin UI toolkit | **QML / Kirigami**, embedded in the C++ tool view via `QQuickWidget`. `QWebEngineView`/React rejected (embedded Chromium). Calendar is the centerpiece → Kirigami's native look + calendar views win; cost is the Qt Quick runtime (modest, native). |
| Repo location     | **`plugins/kate/` subfolder** of this repo (not a separate repo). Invisible to pnpm (explicit workspace globs); own CMake build + own CI workflow. C++ structs **codegen'd** from `src/domain/types.ts` / `openapi.json` → CI fails on drift.        |
| Distribution      | **Local install** (`cmake --install` → `~/.local/lib64/qt6/plugins/…`). CI builds/compile-checks only; Flatpak/package deferred.                                                                                                                     |
| Auth              | Replicate the browser cookie model: enter key **once** → `POST /session/create` → opaque session id → store in **KWallet** → send `X-Session-Id` on every later call. Direct to `hadoku.me/task/api/*`. **No central daemon.**                       |
| Secret storage    | **KWallet** = local store for the session token. **Vaultwarden** = personal cross-device source of truth for the _raw key_ (seeded manually at setup; not a runtime dependency).                                                                     |
| Data partition    | Plugin uses **your own user-key**, so its session resolves to the same credential the website cookie does → **same tasks**, both directions. (A separate service key would be a different, empty partition.)                                         |
| Write safety      | **L1 + L2 optimistic concurrency**: board carries a `version`; writes present `If-Match`; mismatch → `409`, client re-pulls + retries. Backward-compatible (no `If-Match` ⇒ legacy last-write-wins, so the hosted API is unaffected).                |
| Surfaces          | Kate Tasks + Calendar tabs **and** the Plasma desktop calendar widget.                                                                                                                                                                               |

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

| Module             | Type / base                         | Responsibility                                                                                                                                                                             |
| ------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TaskPlugin`       | `KTextEditor::Plugin`               | Entry point + `plugin.json` metadata; one global instance; `createView()`.                                                                                                                 |
| `TaskPluginView`   | `QObject`, `KXMLGUIClient`          | Per-MainWindow; creates the two tool views via `createToolView(...)`; registers actions/shortcuts.                                                                                         |
| `SessionManager`   | `QObject`                           | First-run key prompt → `POST /session/create`; read/write session id in **KWallet**; attach `X-Session-Id`; on `401` trigger re-auth.                                                      |
| `TaskApiClient`    | `QObject` (`QNetworkAccessManager`) | Thin typed wrapper over REST (`/tasks`, `POST /`, `PATCH /{id}`, `/{id}/complete`, `DELETE /{id}`, `/stats`, boards). Holds board `version`; sends `If-Match`; on `409` → refetch + retry. |
| `domain` (structs) | plain C++/JSON                      | Mirror of `src/domain/types.ts` (`Task`, `Board`). Kept in lockstep with the TS contract (optionally codegen from `openapi.json`).                                                         |
| `TaskStore`        | `QAbstractItemModel`                | In-memory model backing both views; current board + version; change signals; optional on-disk cache for offline _viewing_.                                                                 |
| `TasksToolView`    | `QQuickWidget` + QML                | Kirigami list of tasks; **quick-add input (capture)**; complete/delete/tag actions; tag filter. Bound to `TaskStore`.                                                                      |
| `CalendarToolView` | `QQuickWidget` + QML                | Kirigami day/timeline of tasks with `startTime`/`endTime`; create-from-timeslot; drag-to-reschedule (mirrors web `CalendarDayView`; borrow Merkuro views). Heaviest UI piece.              |
| `SyncController`   | `QObject`                           | Pull on a timer + on focus; push on edit; L1 staleness + L2 version-conflict handling; (full build) offline write queue.                                                                   |
| `TaskConfigPage`   | `KTextEditor::ConfigPage`           | Settings: server base URL, poll interval, default board, re-auth/sign-out.                                                                                                                 |

---

## 4. Server-side work (this repo) — L1 + L2 concurrency

Additive changes only; legacy clients keep last-write-wins.

1. Add monotonic `version: number` (and `lastActionAt`) to `TasksFile` (the board blob).
2. `GET /tasks` returns the version (response body field + `ETag` header).
3. Mutations (`POST /`, `PATCH`, `complete`, `DELETE`, batch) accept `If-Match: <version>`:
   - present + matches → apply, bump version, return new version;
   - present + stale → `409 Conflict` (+ current version) so client re-pulls/retries;
   - **absent → current behavior** (backward-compatible; hosted web app unaffected).
4. Keep the existing in-memory per-instance `withBoardLock`. Document the residual cross-instance
   race + KV eventual-consistency window as acceptable for a single user.
5. (Later, optional) migrate the web client (`useTasks`) to send `If-Match` too, so the website
   benefits from the same guard.

---

## 5. Plasma desktop calendar surface

- **MVP (recommended):** API exposes an **ICS feed** of scheduled tasks (tasks with
  `startTime`/`endTime` → `VEVENT`s), or the capture watcher writes a local `.ics`. Add it as an
  ICS calendar resource in KOrganizer/Akonadi → the Plasma digital-clock calendar applet renders
  the events. Reuses Plasma's built-in PIM calendar; minimal new code.
  - **Verify/install:** the applet's PIM **event plugin** (from `kdepim-addons`) — currently only
    `holidayevents` is present on this box.
- **Full:** custom **Plasmoid (QML)** reading tasks directly from the API/local store. More control,
  more work, not gated on Akonadi.

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

### Phase 0 — API hardening (server, this repo)

Add board `version` + `If-Match`/`409`; backward-compatible. Also fix two bugs found during live
verification: (a) `POST /task/api/` with a **trailing slash** → 404 (only `/task/api` matches);
(b) `DELETE`/`PATCH` on a **non-existent or non-active** task → `500` instead of `404` (and not
idempotent). Plugin client must avoid the trailing slash regardless.
**DoD:** new field present; `If-Match` mismatch → `409`; absent `If-Match` → unchanged behavior;
trailing-slash create works or is documented; delete-missing → `404`; existing Playwright e2e green.

### Phase 1 — Plugin skeleton + auth (MVP core)

KTextEditor plugin loads in Kate; empty Tasks tab; `SessionManager` (key → `/session/create` →
KWallet → `X-Session-Id`).
**DoD:** plugin builds via CMake and appears as a tool-view tab; first-run key prompt mints + caches
a session; session **survives Kate restart**; `whoami` confirms identity.

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

ICS feed → Akonadi resource → Plasma applet (install PIM event plugin).
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

- Plasma calendar PIM **event plugin** (`kdepim-addons`) — only `holidayevents` found; needed for §5 MVP.

**Decided ✅**

- UI toolkit: **QML/Kirigami** (embedded via `QQuickWidget`). Repo: **`plugins/kate/`** subfolder;
  local-install distribution; C++ types codegen'd from the contract.

**To decide 🟡**

- Task **notes/body** field — defer (recommended) vs add now.
- Plasma calendar: ICS→Akonadi (MVP) vs custom plasmoid (full).

**Non-negotiable constraint**

- Server changes stay backward-compatible; hosted web app + API behavior unchanged (guarded by
  existing Playwright e2e).
