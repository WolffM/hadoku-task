# Task: history

## A plain web app (September–October 2025)

The first commit was a React task list with no server (`835e0bd`, 2025-09-30).
Six days later a big refactor (`4788cb0`, 2025-10-06) added an Express server
and a filesystem storage mode. Nine days after that the Express server
was pulled back out: "all modes use same methods now" (`614aefe`,
2025-10-15) — the start of the framework-agnostic adapter pattern that still
shapes the repo. The result is pure handlers that a Worker, a filesystem or
a test can all call the same way ([`docs/ARCHITECTURE.md`](../ARCHITECTURE.md)).

## Becoming a Cloudflare Worker (October 2025 – March 2026)

Over the following months the app grew its API client, its multi-board
model and its themes. The framework-agnostic design paid off on 2026-03-17,
when the handlers gained a `@wolffm/task/worker` export: a Cloudflare Worker
entry point built from the same core, in the single biggest commit in the
repo's history — 164 files, nearly 56,000 lines (`082d5a4`).

## One afternoon: the Kate plugin and MCP (2026-06-06)

In a single afternoon the task API gained a third interface. It started as
an embedding spike for the [Kate](https://kate-editor.org/) text editor
(`68ab0cf`, 12:32), then became a live Tasks tab with real create/read/update
against the API barely an hour later (`52d0b22`, 13:46), then grew a
Calendar tab two hours after that (`b039c16`, 15:49). That evening the task
API itself grew a remote [MCP](https://modelcontextprotocol.io) server so
an agent could do the same things over JSON-RPC (`9c4979b`, 20:48). The plugin
kept moving for months afterward — drag-and-drop, notes, filtering, a
dedicated CI job — but all of it builds on what landed that one day.

## Sharing, automation and themes (July–August 2026)

Themes moved onto a stricter footing on 2026-07-21, when every color family
was made symmetric and paired with a Tailwind color package (`84f59ac`).
Three days later, on 2026-07-24, within 21 minutes of each other, boards
learned to be shared by handle with another account (`b43534d`) and to be
activated as **automation boards**, whose tags become a fixed, enforced lane
set (`8331213`). Twenty days later, automation learned to read a repo's own
open issues and pull requests and turn them into tasks on arrival
(`9ff51f0`, 2026-08-13).

## Trackers and the theme editor (October–November 2026)

A hosted **theme editor** at `hadoku.me/task/editor` let a service-tier
caller change the platform's live colors from the browser, committing and
publishing the change itself (`9d19397`, 2026-10-23). Seventeen days later,
**tracker boards** gave wife tier a counter/value board with a history log
(`19a5e9f`, 2026-11-09); six days after that, trackers stopped being their
own kind of board and became a widget any board could add (`9fcb121`,
2026-11-15). Six days after that, **exercise sequences** joined trackers in
the widget strip: a shared library of exercises and workouts, played with a
countdown and timer, with every exercise played logged (2026-11-21).

## The mobile wrapper

[hadoku-task-mobile](https://github.com/WolffM/hadoku-task-mobile) is an
Android app that wraps this app's own UI in a Capacitor WebView — it ships no
task logic of its own. Its first commit, "the whole thing", is the whole
Capacitor project at once (`WolffM/hadoku-task-mobile@d77c7a4`, 2025-10-15).
About six and a half months later it was changed to load `hadoku.me/task`
directly rather than a bundled copy, so the browser's sign-in cookie works
inside the WebView the same way it does on the web
(`WolffM/hadoku-task-mobile@bd45a03`, 2026-04-30). Like this repo's own
packages, its version is no longer a committed number: a release run
computes the next `versionName` and `versionCode` and tags it, rather than a
commit bumping a file (`WolffM/hadoku-task-mobile@9f3d505`, 2026-11-01).

## Removed along the way

| What                             | Added     | Removed   | Why                                                       |
| -------------------------------- | --------- | --------- | --------------------------------------------------------- |
| The Express server               | `4788cb0` | `614aefe` | replaced by framework-agnostic handlers any backend calls |
| Tracker boards as their own type | `19a5e9f` | `9fcb121` | became a widget any board can add, not a separate kind    |
| `husky`'s default hook path      | `a2e145b` | `755a535` | a fresh worktree checked out no hook at all from it       |

## Trivia

The repo's biggest commit (`082d5a4`, 2026-03-17) and its shortest commit
message, one letter, "m" (`7c09a49`, 2025-10-02), are about five and a half
months apart — more in [trivia.md](trivia.md).
