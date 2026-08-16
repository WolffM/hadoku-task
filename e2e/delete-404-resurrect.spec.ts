import { test, expect, type APIRequestContext } from '@playwright/test'

/**
 * REGRESSION GUARD — "I delete the task, refresh, and it comes back."
 *
 * Two independent defects compose into an unfixable-by-the-user loop:
 *
 *  1. SERVER: an unknown board slug used to resolve to "the caller's own
 *     not-yet-created board of that slug", so a DELETE aimed at the wrong board
 *     searched an EMPTY board and blamed the task — `TASK_NOT_FOUND`. Task
 *     mutations now pass `mustExist`, so the board is named as the fault.
 *
 *  2. CLIENT: `isDefinitiveRefusal` counts 404 as a refusal, so the delete's
 *     undo RE-CREATES the task locally — proved end to end against the real
 *     server in delete-404-realloop.spec.ts.
 *
 * Requires the local API stack (`node scripts/dev-api.mjs`).
 */

const API = 'http://127.0.0.1:3001/task/api'

async function apiUp(request: APIRequestContext): Promise<boolean> {
  try {
    return (await request.get(`${API}/automation/presets`)).ok()
  } catch {
    return false
  }
}

test.describe('a 404 on delete resurrects the task', () => {
  test('SERVER: deleting with the wrong board ref blames the BOARD, not the task', async ({
    request
  }) => {
    test.skip(!(await apiUp(request)), 'dev API stack not running (node scripts/dev-api.mjs)')

    const stamp = Date.now().toString(36)
    const realBoard = `d404-real-${stamp}`
    const wrongBoard = `d404-wrong-${stamp}`
    const taskId = `${realBoard}-t`

    expect(
      (await request.post(`${API}/boards`, { data: { id: realBoard, name: realBoard } })).ok()
    ).toBe(true)
    expect(
      (
        await request.post(API, {
          data: { boardId: realBoard, id: taskId, title: 'Stubborn task' }
        })
      ).ok()
    ).toBe(true)

    // The exact shape of the customer's report: the delete names a board the
    // task does not live on. That must be reported as the missing BOARD it is.
    const res = await request.delete(`${API}/${taskId}?boardId=${wrongBoard}`)
    expect(res.status()).toBe(404)
    const body = await res.json()
    expect(body.code).toBe('BOARD_NOT_FOUND')
    expect(body.error).toContain(wrongBoard)

    // ...and the task is untouched, so nothing is silently dropped locally.
    const tasks = (await (await request.get(`${API}/tasks?boardId=${realBoard}`)).json()).tasks
    expect(tasks.some((t: { id: string; state: string }) => t.id === taskId)).toBe(true)
    expect(tasks.find((t: { id: string }) => t.id === taskId).state).toBe('Active')
  })

  test('SERVER: a genuinely missing task names the board it searched', async ({ request }) => {
    test.skip(!(await apiUp(request)), 'dev API stack not running (node scripts/dev-api.mjs)')

    const boardId = `d404-msg-${Date.now().toString(36)}`
    expect(
      (await request.post(`${API}/boards`, { data: { id: boardId, name: boardId } })).ok()
    ).toBe(true)

    const res = await request.delete(`${API}/NOSUCHTASK000000000000000?boardId=${boardId}`)
    expect(res.status()).toBe(404)
    const body = await res.json()
    expect(body.code).toBe('TASK_NOT_FOUND')
    // The board is in the message — a bare "Task <id> not found" is what made
    // the original report take a log dig to diagnose.
    expect(body.error).toContain(boardId)
  })
})
