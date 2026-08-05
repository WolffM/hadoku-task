# Incident: auto-update pushes rejected by protected main — 10 failures (2026-08-04)

> Written 2026-08-05 by an outside investigation run from `hadoku_site`, working
> only from GitHub Actions logs and commit history — it never ran anything in
> this checkout. Treat every claim below as a **hypothesis to verify against
> this repo's own evidence** before acting on it. Verify first, then fix.

## What the daily CI digest showed

`hadoku-task / Auto-update @wolffm packages` — **10 failures**, latest run
green. All ten between 21:45 and 22:28 UTC on 2026-08-04, at timestamps
**identical to hadoku-resume-bot's ten failures** — the same publish storm
dispatched to both repos, and both broke the same way.

## Evidence gathered from outside

- Each failed run had a real payload to push and died on
  `GH006: Protected branch update failed for refs/heads/main` /
  `required status checks are expected`. The bot pushed with the default
  `GITHUB_TOKEN`, which cannot bypass required checks. Sample failed run: 30956524388.
- The push-retry loop (fetch → rebase → push ×3) rebased onto an up-to-date
  main every time — the rejection was deterministic, not a race.
- 2026-08-04 22:32, `4276cf2e` — `fix(ci): let the auto-update bot push to a
protected main` — set `token: ${{ secrets.HADOKU_SITE_TOKEN }}` on checkout
  in the update workflow. The next run (22:33) landed `e60703e9`
  (`chore: auto-update @wolffm/* to latest`) on main, so the recovery is real,
  not an empty-payload success.

## Root-cause hypothesis

Required status checks were (recently) enforced on main, and the one workflow
that pushes to main directly was never given a token that can bypass them.
The failure only fires when there is actually something to push, so it can sit
green for weeks between publish bursts.

## Your task

1. **Verify independently.** Confirm from this repo's own state: the branch
   protection config (required checks, `enforce_admins`), that the update
   workflow now checks out with `HADOKU_SITE_TOKEN`, and that post-fix bot
   commits (`e60703e9`, `2a004309`) both landed AND had their required checks
   actually run green (PAT-pushed commits trigger workflows; `GITHUB_TOKEN`
   pushes would not — make sure the checks are not silently absent).
2. **Then fix what verification confirms.** Candidates found from outside:
   - **Silent-failure window**: ten consecutive red runs surfaced nowhere until
     the next daily digest. Decide whether this workflow failing should report
     to `/health/api/jobs` or otherwise alert (tenhands' `taskauto.yml` has the
     self-report pattern).
   - **Retry loop treats every rejection as a race**: distinguish
     "non-fast-forward" (rebase and retry) from "protected branch hook
     declined" (deterministic — fail fast with a message naming the token fix)
     so the next occurrence is diagnosable from the first log line.

If your investigation contradicts anything above, trust your evidence, not
this document — and correct this file so the record is right.

---

## Verification & resolution (2026-08-05, run from this repo)

Every claim above checked out against primary evidence:

- **Branch protection** (`gh api .../branches/main/protection`): required checks
  `typecheck`, `lint`, `worker-tests` (strict=false), `enforce_admins` **off** —
  which is exactly why the admin PAT bypasses them.
- **Token fix is live**: `update-wolffm.yml` on main checks out with
  `token: HADOKU_SITE_TOKEN` (landed in `4276cf2e`), and post-fix bot commits
  `e60703e9` / `2a004309` are both on main.
- **Required checks on bot commits are absent — structurally, not silently.**
  Only `publish` ran on those commits. `ci.yml` (the workflow behind all three
  required contexts) triggers on `pull_request` only, so NO direct-to-main
  push — bot or human — ever runs them. That predates the incident and is the
  repo's design: PR gates for reviewed work, publish build as the backstop for
  direct pushes.

### New regression found during verification: double publish

The token fix introduced a second bug the outside investigation couldn't see.
The explicit `publish.yml` dispatch in the push step existed because
GITHUB_TOKEN pushes don't trigger `on: push` workflows. A PAT push **does** —
so after `4276cf2e`, every auto-update push ran publish.yml twice (push event +
dispatch, same second: runs on `e60703e9`, `2a004309`, `e73bcabd`). On
2026-08-05 the pair raced past publish.yml's tolerate-concurrent-runs logic and
published **two versions for one dep bump** — `@wolffm/themes`/`task` 4.0.1
(13:14:23) and 4.0.2 (13:14:32) — each dispatching `packages_updated` to
hadoku_site.

### Fixes applied (this commit)

1. **Removed the explicit publish dispatch** (and the now-unneeded
   `actions: write` permission) — the PAT push triggers publish.yml natively.
2. **Retry loop distinguishes rejection classes**: GH006 / "protected branch
   hook declined" fails fast on the first attempt with a message naming the
   token fix; only non-fast-forward rejections rebase and retry.
3. **Failure streaks now alert**: an `if: always()` step reports the outcome to
   `POST /health/api/jobs` (`job_name: hadoku-task:update-wolffm`), the fleet's
   alerting path — Discord on break, 24h-throttled reminders, recovery notice.
   Uses the `KEY_SERVICE_HADOKU_TASK` Actions secret (this repo's service-tier
   key). Runner-death mid-run still can't self-report; the daily digest covers
   that class.

**hadoku-resume-bot has the same double-publish + no-alerting gaps** (same
workflows, same token fix applied) and was not touched here — this incident is
scoped to hadoku-task.
