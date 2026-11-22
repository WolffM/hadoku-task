# Task: features

What Task does and how to use it. How it is built is in
[contributing.md](contributing.md).

"Friend", "service" and "wife" below are hadoku.me tiers: a feature marked
with one needs that tier and up; everything else works at every tier,
including signed out ("public").

## Tasks and boards

**What it does.** Type a task's title and press Enter to add it. Give it a
`#tag` anywhere in the title to file it, and filter the list down to one tag.
On an existing task: check it off (and reopen it the same way), click its
title to rename it, use the tag button to retag it, or delete it outright.
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
pull requests. A lane is a stage of work, and a task moving between lanes
is reported back as the repo's state changing. The board can also pull
presets — a ready-made lane set — from another automation tool on the
platform ([TenHands](https://github.com/WolffM/hadoku-tenhands)) instead
of a hand-built one.

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

## Exercise sequences

_Guest tier and up for the library; member tier and up to put one on a board_
(`worker/src/routes/library.ts`, `worker/src/routes/sequences.ts`).

**What it does.** A sequence is a workout you play: exercises in a line, each
with a name and a picture of the movement. Every exercise starts with a 5 s
countdown (a tick at 3, 2 and 1, and a "go" sound), then either runs a timer
and moves on by itself, or waits for you to press **Done — next**. The player
shows the exercise, a timer bar, and a minimap of every exercise in the
sequence underneath, with back, play/pause and skip.

**How to use it.** Press the **Exercise library** button on the board toolbar
to browse everyone's sequences and exercises, play one, or make your own. An
exercise is a name, a description and a picture. A sequence is exercises in
order, each timed (in seconds) or manual. To keep one on a board, press
**Add a widget** and pick a sequence; its tile's button is **Play**, which
opens the player paused until you press play. Tap the tile anywhere else for
its recent runs.

**What it does not do.** Nobody else's edit can change your workout. Saving an
exercise or sequence makes a new version, and a board keeps the version it
was given until its owner presses **Update**. Deleting one only takes it out of
the library; boards that have it keep playing it. You can edit or delete only
what you made (an admin can do either to anything). Pictures are public, up
to 5 MB and 30 a day. Every exercise played is logged:
completed, skipped, gone back to, or stopped. The same exercise played twice
is logged twice.

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

## Theme picker

**What it does.** Eight theme families, each with a light and a dark
variant: sixteen themes total. The families: Light/Dark (the defaults),
Ocean (deep sea blues), Cyberpunk (neon dystopia), Coffee (rich espresso),
Lavender (soft purple), Nature (lush forest greens), Pink (bubblegum), and
Izakaya (a cozy Japanese bar aesthetic).

**How to use it.** Pick one from the theme picker, top-right of the board.
Every color in the app, including the theme editor's own live preview, is a
token from the chosen family — see
[contributing.md](contributing.md#architecture) for how that's enforced.

**What it does not do.** A theme is a per-browser preference; it is not part
of what a shared board stores, so two people viewing the same board can see
it in different themes.

## Verifying a guest account

_Guests only_ (`task-ui-components/src/components/AccountPrompts.tsx`).

**What it does.** Every hadoku.me app renders this package's header, and the
header's verify dialog opens when a guest reaches something that needs a
verified account (a `403 MEMBER_NOT_VERIFIED`, or an app's
`requestVerification()`). It offers the ways a guest verifies themself: save
a passkey, connect Discord, connect Steam. Any one of them makes the account
a member at once: the site's edge promotes them when the passkey is saved or
the link completes, so the dialog only refreshes who they are. "I already
have an account" signs in to the old one.

**How to use it.** Press one of the buttons. Connect shows what Discord or
Steam shares and keeps before anything is fetched, then links in a popup;
the page underneath never navigates.

**What it does not do.** It sends nobody a request: the operator does not
review a guest any more. Unlinking or losing a passkey later does not take
verification away, and a guest the operator unverified stays a guest until
the operator verifies them again.

## Trivia

Trackers started as their own kind of board and became a widget any board
can add, six days later (`19a5e9f`, `9fcb121`). More trivia is in
[trivia.md](trivia.md).
