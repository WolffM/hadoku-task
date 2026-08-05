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
  `GITHUB_TOKEN`, which cannot bypass required checks. Sample failed run:
  30956524388.
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
