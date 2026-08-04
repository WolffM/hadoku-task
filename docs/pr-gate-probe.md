# PR-gate probe

Temporary. This file exists to test one thing, and it is not "is CI green".

The invariant (tenhands `docs/hadoku-task-automation/pr-gate-invariant.md`) is:

> For every pull request a repo can receive, at least one **required** status
> check must report a result.

The PR that added `ci.yml` could only ever prove the **run** path — its own diff
touched `.github/workflows/ci.yml`, which all three scope lists match, so all
three jobs ran in full. The **skip** path needs a PR that touches nothing any
job cares about, opened against a `main` that already carries the workflow.

This file is that PR. Expected: `typecheck`, `lint` and `worker-tests` all
report green in seconds, with their scope steps saying they found nothing to do.
Deleted immediately after.
