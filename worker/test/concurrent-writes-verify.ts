/**
 * Two writes to one board that overlap must not undo each other.
 *
 * Every task write is read → change one task → save. The save used to write
 * back the WHOLE board it had read: every visible task upserted from that
 * snapshot, every visible row missing from it deleted. Two requests that
 * overlapped (different isolates — the in-memory board lock only serializes
 * requests in the same one) each wrote their snapshot, and the later one put
 * back its stale copy of whatever the earlier one changed.
 *
 * Seen in prod 2026-11-17 03:16: 19 shopping-list completes in 11s, all 200,
 * and the three that overlapped another complete came back Active.
 *
 * The in-process lock would serialize two HTTP requests here, so the race is
 * built by hand at the storage seam, in the order prod ran it: read A, read B,
 * write A, write B.
 *
 * Run via: pnpm run test:worker  (or `... concurrent-writes-verify`).
 */
import { join } from 'node:path'
import type { Task, TasksFile } from '@wolffm/task/api'
import { createD1Storage } from '../src/routes/d1-storage'
import { makeSqliteD1 } from './lib/d1-sqlite'
import type { Env } from '../src/types'

const MIGRATION = join(process.cwd(), 'worker/migrations')
const UID = 'race-uid'
const BOARD = 'main'

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

const now = () => new Date().toISOString()
const task = (id: string): Task =>
  ({ id, title: id, state: 'Active', createdAt: now(), tag: null }) as Task

function complete(file: TasksFile, id: string): TasksFile {
  return {
    ...file,
    version: (file.version ?? 1) + 1,
    tasks: file.tasks.map(t =>
      t.id === id ? { ...t, state: 'Completed', closedAt: now(), updatedAt: now() } : t
    )
  }
}

function freshEnv(ids: string[]) {
  const d1 = makeSqliteD1(MIGRATION)
  const env = { DB: d1 } as unknown as Env
  return { env, d1, ids }
}

async function seed(env: Env, ids: string[]) {
  const s = createD1Storage(env)
  await s.getTasks('friend', UID, BOARD)
  await s.saveTasks('friend', UID, BOARD, { version: 2, updatedAt: now(), tasks: ids.map(task) })
}

async function stateOf(env: Env): Promise<Record<string, string>> {
  const t = await createD1Storage(env).getTasks('friend', UID, BOARD)
  return Object.fromEntries(t.tasks.map(x => [x.id, x.state]))
}

async function main() {
  console.log('Overlapping task writes')

  console.log('\n1. Two completes of different tasks both land')
  {
    const { env } = freshEnv([])
    await seed(env, ['milk', 'eggs', 'bread'])
    const A = createD1Storage(env)
    const B = createD1Storage(env)
    const readA = await A.getTasks('friend', UID, BOARD)
    const readB = await B.getTasks('friend', UID, BOARD)
    await A.saveTasks('friend', UID, BOARD, complete(readA, 'milk'))
    await B.saveTasks('friend', UID, BOARD, complete(readB, 'eggs'))
    const s = await stateOf(env)
    check('milk (written first) stays Completed', s.milk === 'Completed', JSON.stringify(s))
    check('eggs (written second) is Completed', s.eggs === 'Completed', JSON.stringify(s))
    check('bread untouched', s.bread === 'Active', JSON.stringify(s))
  }

  console.log('\n2. A task created during another write survives it')
  {
    const { env } = freshEnv([])
    await seed(env, ['milk'])
    const A = createD1Storage(env)
    const B = createD1Storage(env)
    const readA = await A.getTasks('friend', UID, BOARD)
    const readB = await B.getTasks('friend', UID, BOARD)
    await B.saveTasks('friend', UID, BOARD, {
      ...readB,
      version: (readB.version ?? 1) + 1,
      tasks: [...readB.tasks, task('butter')]
    })
    await A.saveTasks('friend', UID, BOARD, complete(readA, 'milk'))
    const s = await stateOf(env)
    check('butter (created mid-write) still exists', s.butter === 'Active', JSON.stringify(s))
    check('milk is Completed', s.milk === 'Completed', JSON.stringify(s))
  }

  console.log('\n3. A delete still deletes, and only what it removed')
  {
    const { env } = freshEnv([])
    await seed(env, ['milk', 'eggs'])
    const A = createD1Storage(env)
    const readA = await A.getTasks('friend', UID, BOARD)
    await A.saveTasks('friend', UID, BOARD, {
      ...readA,
      version: (readA.version ?? 1) + 1,
      tasks: readA.tasks.filter(t => t.id !== 'milk')
    })
    const s = await stateOf(env)
    check('milk is gone', !('milk' in s), JSON.stringify(s))
    check('eggs remains', s.eggs === 'Active', JSON.stringify(s))
  }

  console.log('\n4. The board version never goes backwards under overlap')
  {
    const { env, d1 } = freshEnv([])
    await seed(env, ['milk', 'eggs'])
    const A = createD1Storage(env)
    const B = createD1Storage(env)
    const readA = await A.getTasks('friend', UID, BOARD)
    const readB = await B.getTasks('friend', UID, BOARD)
    await A.saveTasks('friend', UID, BOARD, complete(readA, 'milk'))
    await B.saveTasks('friend', UID, BOARD, complete(readB, 'eggs'))
    const row = d1.__raw
      .prepare('SELECT tasks_version AS v FROM boards WHERE user_id = ? AND id = ?')
      .get(UID, BOARD) as { v: number }
    check(
      'two writes from version v leave it at v + 2',
      row.v === (readA.version ?? 1) + 2,
      `read ${readA.version}, now ${row.v}`
    )
  }

  console.log('\n5. A cross-board move still moves (batchSaveTasks)')
  {
    const { env } = freshEnv([])
    await seed(env, ['milk'])
    const s = createD1Storage(env)
    const src = await s.getTasks('friend', UID, BOARD)
    const dst = await s.getTasks('friend', UID, 'pantry')
    const moved = src.tasks.find(t => t.id === 'milk') as Task
    await s.batchSaveTasks('friend', UID, [
      { boardId: BOARD, tasks: { ...src, tasks: [] } },
      { boardId: 'pantry', tasks: { ...dst, tasks: [moved] } }
    ])
    const after = createD1Storage(env)
    const a = await after.getTasks('friend', UID, BOARD)
    const b = await after.getTasks('friend', UID, 'pantry')
    check('milk left the source board', a.tasks.length === 0, JSON.stringify(a.tasks))
    check(
      'milk is on the target board',
      b.tasks.some(t => t.id === 'milk'),
      JSON.stringify(b.tasks)
    )
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
