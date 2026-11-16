# Task: features

What Task does and how to use it. How it is built is in
[contributing.md](contributing.md).

"Friend", "service" and "wife" below are hadoku.me tiers: a feature marked
with one needs that tier and up; everything else works at every tier,
including signed out ("public").

## Tasks and boards

**What it does.** Type a task's title and press Enter to add it. Give it a
`#tag` anywhere in the title to file it, and filter the list down to one tag.
Drag a task to reorder it, or drop it onto another board's chip to move it
there. A board can hold more than one view: the task list, or (see
[Calendar](#calendar)) a schedule.

**How to use it.** Open [hadoku.me/task](https://hadoku.me/task/). The board
switcher sits above the list; **Edit Boards** creates, renames or deletes one.
A signed-out visitor's boards are **public**: kept only in that browser's
`localStorage`, under nobody's account. Signing in moves a board onto the
server, where it survives a new device and a cleared browser.

**What it does not do.** A public board never leaves the browser it was
created in — there is nothing to sign into to get it back on another device.
Deleting a board deletes its tasks; there is no undo.

## Sharing a board

**What it does.** A board's owner can grant another named person
**Contributor** (can add, edit and complete tasks) or **Read-only** access.
Every share is by display name, not by board address, so a board you cannot
see never leaks its existence.

**How to use it.** In **Edit Boards**, click the share icon beside a board you
own. Type the person's name, pick a level, and grant it. A board shared with
you appears in your own board switcher, named after whoever shared it; open it
like any board of your own.

**What it does not do.** Only a board's owner can share it — a contributor
cannot re-share it with a third person. There is no "everyone with the link"
level; a grant always names one person.

## Calendar

**What it does.** A day/agenda view lays scheduled tasks against the clock
instead of a list, with all-day tasks pinned above the timed ones.

**How to use it.** Press the calendar toggle in the board toolbar. Give a task
a date (and optionally a start and end time) to place it on the grid; drag a
timed task to move it, or drag its edge to resize it. Two overlapping tasks
draw in side-by-side columns rather than hiding one behind the other.

**What it does not do.** The calendar shows one board's tasks at a time —
there is no merged view across boards.

## Automation boards

_Friend tier and up_ (`worker/src/routes/automation-reads.ts`,
`worker/src/routes/automation-repo.ts`).

**What it does.** Linking a board to a GitHub repo replaces its freeform tags
with a fixed, ordered set of lanes that mirror that repo's open issues and
pull requests: a lane is a stage of work, and a task moving between lanes is
reported back as the repo's state changing. The board can also pull presets —
a ready-made lane set — from another automation tool on the platform
([TenHands](https://github.com/WolffM/hadoku-tenhands)) instead of a hand-built
one.

**How to use it.** In **Edit Boards**, open a board's automation panel, paste
the repo's URL (or pick a preset) and click **Activate**. This replaces the
board's tag structure, so the dialog warns that it is destructive.
Thereafter, moving a task between lanes is itself the automation signal — no
separate "sync" step.

**What it does not do.** Activation is one-way: a board can be deactivated,
but its lane structure cannot be reshaped back to freeform tags without
losing it. Only a contributor or the owner may move tasks across an
automation board's lanes.

## Trackers

_Wife tier and up_ (`worker/src/routes/trackers.ts`).

**What it does.** A counter or value widget on any board, each logging every
change to a history you can read back by day. A counter's button adds one tap
at a time; a value tracker's button logs whatever you last set.

**How to use it.** With trackers allowed for your tier, press **Add a
widget** on a board you can write to, and choose a counter or a value
tracker. Tap a
tracker's own button to log an entry in one tap; tap anywhere else on its tile
to open its history, where you can undo the last entry, set an exact value, or
rename and delete the tracker.

**What it does not do.** Trackers hold no `localStorage` copy: every tap goes
straight to the server and reads it back, so an entry logged from somewhere
else (automation, another device) shows up immediately. Below wife tier, or
with only read access to the board, the widget and its button do not appear.

## Theme editor

_Service tier and up_ (`worker/src/routes/theme-editor.ts`).

**What it does.** Edits the live color tokens that every hadoku app shares,
from a page in the browser — no local checkout, no pull request. A save
commits the change to the repo's `main` branch and publishes the updated
package itself.

**How to use it.** Open
[hadoku.me/task/editor](https://hadoku.me/task/editor). Pick a theme and a
token, enter a color, and watch the editor's own live contrast check. Saving
re-checks every rule the project's CI would (paired tokens stay readable
together) before it commits.

**What it does not do.** It edits color values only — it cannot add a token,
a theme, or any other file. A save that fails the contract check is refused
with the reason, and nothing is committed.

## MCP for agents

**What it does.** A remote [MCP](https://modelcontextprotocol.io) server lets
an agent (such as Claude Code) list, create and update tasks and calendar
entries directly, scoped to whichever key it connects with — the same
identity your own browser session resolves to.

**How to use it.** Connect an MCP-capable client to
`https://hadoku.me/task/api/mcp` with your task key as `X-User-Key`:

```sh
claude mcp add --transport http hadoku-tasks https://hadoku.me/task/api/mcp \
  --header "X-User-Key: $HADOKU_TASK_KEY"
```

Every tool defaults to your `main` board; a board shared with you is
addressed by its handle. See [`docs/MCP.md`](../MCP.md) for the full tool
list.

**What it does not do.** The endpoint is stateless request/response, not a
live push feed: an agent polls it rather than being notified of a change made
elsewhere. `initialize` and `tools/list` need no key; every tool that reads or
writes data does.

## Kate plugin

**What it does.** A native `KTextEditor::Plugin` adds **Tasks** and
**Calendar** tool views to the [Kate](https://kate-editor.org/) text editor's
sidebar, talking to the same hosted API as the web app: list, create, tag and
drag-reschedule tasks without leaving the editor.

**How to use it.** Build and install it from `plugins/kate/` (it has its own
CMake build, not part of the pnpm workspace — see
[contributing.md](contributing.md#kate-plugin)), then enable **Hadoku Tasks**
under Kate's **Settings → Configure Kate → Plugins**.

**What it does not do.** It is a desktop build from source today, not a
packaged download; there is no automated install. Sharing, automation boards
and trackers are not in the plugin's view yet — only plain tasks and the
calendar.

## Trivia

Trackers started as their own kind of board and became a widget any board
can add, six days later (`19a5e9f`, `9fcb121`). More trivia is in
[trivia.md](trivia.md).
