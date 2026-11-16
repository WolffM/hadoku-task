# Task: trivia

Each fact names the commit it comes from.

## Trivia

- **One letter.** The shortest commit message in the repo's history is a
  single letter, "m" (`7c09a49`).
- **The biggest commit.** Adding the Cloudflare Worker export touched 164
  files and nearly 56,000 lines in one commit — the largest in the repo
  (`082d5a4`).
- **Three surfaces, one afternoon.** The Kate editor plugin's first two real
  phases (a live Tasks tab, then a Calendar tab) and the task API's MCP
  server for agents all shipped on 2026-06-06, hours apart
  (`52d0b22`, `b039c16`, `9c4979b`).
- **21 minutes apart.** Shared boards and automation boards — two features
  that reshape what a board can be — landed 21 minutes apart on the same day,
  2026-07-24 (`b43534d`, `8331213`).
- **A hook that silently did nothing.** `core.hooksPath` points at a
  directory husky generates and self-ignores, so a plain `git worktree add`
  checked out no hook at all: every gate was skipped and said nothing about
  it, until the hooks moved into a tracked directory (`755a535`).
- **A board type that unbecame one.** Trackers shipped as their own kind of
  board (`19a5e9f`) and were turned into a widget any board could add just
  six days later (`9fcb121`).
- **Busiest day.** 2026-06-06, the day of the Kate plugin's Tasks and
  Calendar tabs and the MCP server, had 70 commits — the busiest day in the
  repo's history (fact sheet, 2026-11-16).
