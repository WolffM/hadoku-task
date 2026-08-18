/**
 * Characterization harness for src/domain/handlers/handlers.ts.
 *
 * WHY THIS EXISTS
 * ---------------
 * vibeCompact flags the file at 558 code lines across 18 exported handlers, and
 * splitting it needs a test first. Most of those handlers are already covered
 * hard: the worker harnesses drive them over real HTTP against a real SQLite D1,
 * which is far better cover than a unit test would give.
 *
 * Two are not. Nothing in worker/test touches `/task/api/tags` or
 * `/task/api/tags/delete`, and no Playwright spec deletes a tag either — so
 * `createTag` and `deleteTag` were reachable only from the UI and asserted by
 * nothing. They get real behavioural coverage here.
 *
 * The rest of the file pins what a code move can silently break and the HTTP
 * harnesses would not necessarily catch: that all 18 handlers are still
 * exported under the same names, and that the three batch handlers — the
 * largest symbols, and the ones being moved — still do what they did.
 *
 * These are pure functions over a Storage interface, so this drives them
 * directly rather than through a worker.
 */
import type { Storage } from '../server/storage'
import type { AuthContext, BoardsFile, StatsFile, TasksFile, UserType } from '../domain/types'
import * as H from '../domain/handlers/handlers'

declare const process: { exit(code: number): never }

let pass = 0
let fail = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}  ${detail}`)
  }
}
function section(t: string) {
  console.log(`\n${t}`)
}

const AUTH: AuthContext = { userType: 'admin' as UserType, sessionId: 'sess-1' }

/** Board-scoped in-memory Storage — enough for the pure handlers, nothing more. */
function makeStorage(): Storage & { boardsRaw(): BoardsFile } {
  const tasks = new Map<string, TasksFile>()
  const stats = new Map<string, StatsFile>()
  let boards: BoardsFile = { version: 1, updatedAt: '', boards: [] }
  const emptyTasks = (): TasksFile => ({ version: 2, updatedAt: '', tasks: [] })
  const emptyStats = (): StatsFile => ({
    version: 2,
    updatedAt: '',
    counters: { created: 0, completed: 0, edited: 0, deleted: 0 },
    timeline: [],
    tasks: {}
  })
  return {
    async getTasks(_u, _s, boardId = 'main') {
      return tasks.get(boardId) ?? emptyTasks()
    },
    async saveTasks(_u, _s, boardId = 'main', t) {
      tasks.set(boardId, t)
    },
    async getStats(_u, _s, boardId = 'main') {
      return stats.get(boardId) ?? emptyStats()
    },
    async saveStats(_u, _s, boardId = 'main', st) {
      stats.set(boardId, st)
    },
    async batchSaveTasks(_u, _s, writes) {
      for (const w of writes) tasks.set(w.boardId, w.tasks)
    },
    async getBoards() {
      return boards
    },
    async saveBoards(_u, b) {
      boards = b
    },
    async deleteBoardData(_u, _s, boardId) {
      tasks.delete(boardId)
      stats.delete(boardId)
    },
    boardsRaw: () => boards
  }
}

/** A board with `tags`, created through the handler so the shape is real. */
async function seedBoard(s: Storage, id: string, tags: string[] = []) {
  await H.createBoard(s, AUTH, { id, name: id })
  for (const t of tags) await H.createTag(s, AUTH, { boardId: id, tag: t })
}

function tagsOf(s: ReturnType<typeof makeStorage>, boardId: string): string[] {
  return s.boardsRaw().boards.find(b => b.id === boardId)?.tags ?? []
}

async function main() {
  console.log('src/domain/handlers/handlers.ts characterization')

  // -------------------------------------------------------------------
  section('1. Every handler is still exported, under the same name')
  // -------------------------------------------------------------------
  const EXPECTED = [
    'batchClearTag',
    'batchMoveTasks',
    'batchUpdateTags',
    'boardCalendar',
    'completeTask',
    'createBoard',
    'createTag',
    'createTask',
    'deleteBoard',
    'deleteTag',
    'deleteTask',
    'getBoardCalendar',
    'getBoardStats',
    'getBoardTasks',
    'getBoards',
    'setPinnedBoards',
    'updateBoard',
    'updateTask'
  ]
  const surface = Object.keys(H).sort()
  check(
    `all ${EXPECTED.length} handlers are exported, and no others`,
    JSON.stringify(surface) === JSON.stringify(EXPECTED),
    `missing=${JSON.stringify(EXPECTED.filter(m => !surface.includes(m)))} extra=${JSON.stringify(
      surface.filter(m => !EXPECTED.includes(m))
    )}`
  )
  check(
    'every one of them is callable',
    surface.every(k => typeof (H as unknown as Record<string, unknown>)[k] === 'function')
  )

  // -------------------------------------------------------------------
  section('2. createTag / deleteTag — the pair nothing else covers')
  // -------------------------------------------------------------------
  {
    const s = makeStorage()
    await H.createBoard(s, AUTH, { id: 'b1', name: 'B1' })

    const added = await H.createTag(s, AUTH, { boardId: 'b1', tag: 'urgent' })
    check(
      'createTag reports the add',
      added.ok === true && /added/.test(added.message),
      added.message
    )
    check(
      'the tag is on the board',
      tagsOf(s, 'b1').includes('urgent'),
      JSON.stringify(tagsOf(s, 'b1'))
    )

    // skipIfExists: re-adding is a no-op that still succeeds, and must NOT
    // duplicate the tag — the board's tag list is a set in all but type.
    const again = await H.createTag(s, AUTH, { boardId: 'b1', tag: 'urgent' })
    check('re-adding the same tag succeeds', again.ok === true, JSON.stringify(again))
    check('...and says it already exists', /already exists/.test(again.message), again.message)
    check(
      '...and does not duplicate it',
      tagsOf(s, 'b1').filter(t => t === 'urgent').length === 1,
      JSON.stringify(tagsOf(s, 'b1'))
    )

    await H.createTag(s, AUTH, { boardId: 'b1', tag: 'later' })
    const removed = await H.deleteTag(s, AUTH, { boardId: 'b1', tag: 'urgent' })
    check(
      'deleteTag reports the removal',
      removed.ok === true && /removed/.test(removed.message),
      removed.message
    )
    check('the tag is gone', !tagsOf(s, 'b1').includes('urgent'), JSON.stringify(tagsOf(s, 'b1')))
    check(
      'and its sibling survived',
      tagsOf(s, 'b1').includes('later'),
      JSON.stringify(tagsOf(s, 'b1'))
    )

    // Removing something that was never there is not an error.
    const noop = await H.deleteTag(s, AUTH, { boardId: 'b1', tag: 'never-added' })
    check('deleting an absent tag still succeeds', noop.ok === true, JSON.stringify(noop))
    check(
      'and changes nothing',
      tagsOf(s, 'b1').join(',') === 'later',
      JSON.stringify(tagsOf(s, 'b1'))
    )
  }

  // -------------------------------------------------------------------
  section('3. The batch handlers, which are the ones being moved')
  // -------------------------------------------------------------------
  {
    const s = makeStorage()
    await seedBoard(s, 'main', ['a', 'b'])
    const t1 = await H.createTask(s, AUTH, { title: 'one' }, 'main')
    const t2 = await H.createTask(s, AUTH, { title: 'two' }, 'main')

    const upd = await H.batchUpdateTags(s, AUTH, {
      boardId: 'main',
      updates: [
        { taskId: t1.id, tag: 'a' },
        { taskId: t2.id, tag: 'b' }
      ]
    })
    check('batchUpdateTags reports both', upd.ok === true, JSON.stringify(upd))
    const after = await H.getBoardTasks(s, AUTH, 'main')
    const byId = (list: Awaited<ReturnType<typeof H.getBoardTasks>>, id: string) =>
      list.find(t => t.id === id)
    check(
      'the first task carries its new tag',
      byId(after, t1.id)?.tag === 'a',
      JSON.stringify(byId(after, t1.id))
    )
    check('the second one too', byId(after, t2.id)?.tag === 'b', JSON.stringify(byId(after, t2.id)))

    const cleared = await H.batchClearTag(s, AUTH, { boardId: 'main', tag: 'a', taskIds: [t1.id] })
    check('batchClearTag succeeds', cleared.ok === true, JSON.stringify(cleared))
    const afterClear = await H.getBoardTasks(s, AUTH, 'main')
    check(
      'the cleared task has no tag',
      !byId(afterClear, t1.id)?.tag,
      JSON.stringify(byId(afterClear, t1.id))
    )
    check(
      'the untouched one keeps its tag',
      byId(afterClear, t2.id)?.tag === 'b',
      JSON.stringify(byId(afterClear, t2.id))
    )

    await seedBoard(s, 'dest')
    const moved = await H.batchMoveTasks(s, AUTH, {
      sourceBoardId: 'main',
      targetBoardId: 'dest',
      taskIds: [t2.id]
    })
    check('batchMoveTasks succeeds', moved.ok === true, JSON.stringify(moved))
    const src = await H.getBoardTasks(s, AUTH, 'main')
    const dst = await H.getBoardTasks(s, AUTH, 'dest')
    check('the task left the source board', !byId(src, t2.id), JSON.stringify(src.map(t => t.id)))
    check('and landed on the target', !!byId(dst, t2.id), JSON.stringify(dst.map(t => t.id)))
  }

  // -------------------------------------------------------------------
  section('4. The task lifecycle the batch handlers sit on')
  // -------------------------------------------------------------------
  {
    const s = makeStorage()
    await seedBoard(s, 'main')
    const t = await H.createTask(s, AUTH, { title: 'hello' }, 'main')
    check('createTask returns a ULID', typeof t.id === 'string' && t.id.length > 0, String(t.id))

    const renamed = await H.updateTask(s, AUTH, t.id, { title: 'bye' }, 'main')
    check('updateTask reports ok', renamed.ok === true, JSON.stringify(renamed))

    const done = await H.completeTask(s, AUTH, t.id, 'main')
    check('completeTask marks it Completed', done.state === 'Completed', JSON.stringify(done))
    const reopened = await H.completeTask(s, AUTH, t.id, 'main')
    check('...and toggles back to Active', reopened.state === 'Active', JSON.stringify(reopened))

    const del = await H.deleteTask(s, AUTH, t.id, 'main')
    check('deleteTask reports ok', del.ok === true, JSON.stringify(del))

    const stats = await H.getBoardStats(s, AUTH, 'main')
    check('stats stayed at version 2', stats.version === 2, JSON.stringify(stats.version))
    check(
      'and the timeline recorded the run',
      stats.timeline.length > 0,
      JSON.stringify(stats.timeline.map(e => e.event))
    )
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(e => {
  console.error('HARNESS ERROR:', e)
  process.exit(1)
})
