#!/usr/bin/env bash
# Start scripts/dev-api.mjs in the background for a CI e2e run, and return
# only once the stack that answers is provably this one. Shared by ci.yml's
# e2e job and the nightly e2e.yml, so the two cannot drift.
#
# Specs that need the stack skip themselves when it is down, so a stack that
# never came up reads as skips, not failures — the skip check then fails the
# run on them. Health alone is not enough: jobs on one claw share its ports, and
# a server some other job left on :3001 would answer for a stack whose own bind
# failed. dev-api.mjs exits when any child dies, so it still being alive is
# what proves the answer came from it.
#
# Writes DEV_API_PID to $GITHUB_ENV, for the stop step.
set -uo pipefail

nohup node scripts/dev-api.mjs > dev-api.log 2>&1 &
pid=$!
echo "DEV_API_PID=$pid" >> "$GITHUB_ENV"

for _ in $(seq 1 90); do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "::error::dev-api exited before it came up"; cat dev-api.log; exit 1
  fi
  if curl -sf -o /dev/null http://127.0.0.1:3001/task/api/automation/presets &&
     curl -sf -o /dev/null http://127.0.0.1:3003/prefs/api/v1/_health; then
    sleep 2
    if kill -0 "$pid" 2>/dev/null; then cat dev-api.log; exit 0; fi
    echo "::error::dev-api exited after its ports answered — another process holds them"; cat dev-api.log; exit 1
  fi
  sleep 1
done
echo "::error::the stack did not answer within 90s"; cat dev-api.log; exit 1
