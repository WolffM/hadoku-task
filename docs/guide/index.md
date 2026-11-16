---
title: Task
summary: >-
  A multi-user task and calendar manager at
  [hadoku.me/task](https://hadoku.me/task/), usable from the browser alone
  or, once signed in, synced and shared across devices.
features:
  - name: Tasks and boards
    summary: 'Quick entry, #tags, drag-and-drop, and more than one board.'
    anchor: tasks-and-boards
  - name: Sharing a board
    summary: "A board's owner grants another person contributor or read-only access by name."
    anchor: sharing-a-board
  - name: Calendar
    summary: 'A day and agenda view of scheduled tasks, dragged onto a time instead of a list.'
    anchor: calendar
  - name: Automation boards
    summary: 'Link a GitHub repo to a board; its open issues and PRs become tracked lanes.'
    anchor: automation-boards
    tier: friend
  - name: Trackers
    summary: 'Counters and logged values on any board, each with its own history.'
    anchor: trackers
    tier: wife
  - name: Theme editor
    summary: 'Edit the live site colors from the browser; a save commits and publishes itself.'
    anchor: theme-editor
    tier: service
  - name: MCP for agents
    summary: 'A remote MCP endpoint lets an agent create and read your tasks and calendar directly.'
    anchor: mcp-for-agents
  - name: Kate plugin
    summary: 'A native plugin puts Tasks and Calendar tool views in the Kate text editor sidebar.'
    anchor: kate-plugin
trivia:
  - 'Two phases of the Kate plugin and the agent MCP server all shipped in one afternoon, 2026-06-06 (`52d0b22`, `b039c16`, `9c4979b`).'
  - 'The commit that added the Cloudflare Worker export touched 164 files and nearly 56,000 lines, the biggest single commit in the repo (`082d5a4`).'
  - 'A worktree once skipped every pre-commit gate silently, because the hook directory husky writes is not the one git checks out; the fix moved the hooks into a tracked directory (`755a535`).'
  - 'The shortest commit message in the repo is one letter: "m" (`7c09a49`).'
---

# Task

Task is a small, portable task manager, live at
[hadoku.me/task](https://hadoku.me/task/) and installable as a micro-frontend
in any other app. Type a title and press Enter; organize with `#tags`; drag a
task to reorder it or move it to another board. Anyone can use a board from
the browser alone — it lives in `localStorage` and never reaches a server.

![Task's calendar day view: five scheduled tasks on a timeline, with the current time marked in red](images/calendar.webp)

Signing in with a hadoku.me account turns a board into a synced one: it is
kept on the server, and it can be shared with another person or scheduled
on a calendar. Higher tiers unlock more: wife tier and up can run counters,
friend tier and up can link a board to a GitHub repo, and an agent can
drive a board over MCP with no extra tier needed.

It also ships two ways to reach the same tasks without the web page: an
Android app, and a plugin for the [Kate](https://kate-editor.org/) text
editor.

- [Features](features.md): what each part does and how to use it.
- [Contributing](contributing.md): running it locally, how it is built, how it deploys.
- [History](history.md): from a plain web app to a Worker, an automation workflow and an editor plugin.
- [Trivia](trivia.md)

## Trivia

The Kate plugin went from an embedding spike to a live Tasks tab to a live
Calendar tab, and the task API grew its MCP server for agents, all in one
afternoon ([history](history.md#one-afternoon-the-kate-plugin-and-mcp-2026-06-06)).
