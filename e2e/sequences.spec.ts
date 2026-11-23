import { test, expect } from '@wolffm/e2e-harness/playwright'
import type { APIRequestContext, Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { API } from './helpers/stack'

/**
 * Exercise sequences, end to end against the REAL worker, its sqlite D1 and
 * the dev stack's in-memory fake CDN (worker/test/dev-server.ts).
 *
 *   - the library is guest tier and up and needs no board; building an
 *     exercise uploads its picture, which then renders in the player
 *   - the player opens PAUSED, counts 5 4 3 2 1 then "Go!" (never 0) with a
 *     tick at 3 2 1 and the go sound, runs the timer bar on top of the minimap,
 *     moves on by itself after a timed node and waits on a manual one
 *   - every node play is logged, skips and repeats included
 *   - a sequence is a board widget (member and up) whose tile's button is Play;
 *     it pins a version, so the author's edit shows as an update until taken
 *
 * Runs in real time, so nodes are 1–2 s. `X-Dev-Tier` / `X-Dev-As` give each
 * test its own user at the tier the edge would stamp.
 */

let seq = 0
const newUser = () => `seq-e2e-${Date.now()}-${seq++}`

async function signInAs(page: Page, tier: string, userId: string) {
  await page.addInitScript(
    ([t]) => {
      localStorage.clear()
      localStorage.setItem('hadoku_session_id', 'dev-uid')
      localStorage.setItem('hadoku_user_type', t)
    },
    [tier]
  )
  await page.route('**/task/api**', route =>
    route.continue({
      headers: { ...route.request().headers(), 'x-dev-tier': tier, 'x-dev-as': userId }
    })
  )
}

const as = (tier: string, userId: string) => ({ 'x-dev-tier': tier, 'x-dev-as': userId })

/** A real 2x2 PNG, so the rendered <img> has a natural size to check. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
  'base64'
)

async function seedSequence(
  request: APIRequestContext,
  headers: Record<string, string>,
  name: string,
  nodes: Array<{ exercise: string; mode: 'timed' | 'manual'; seconds?: number }>
) {
  const ids: Record<string, string> = {}
  for (const n of nodes) {
    if (ids[n.exercise]) continue
    const r = await request.post(`${API}/library/exercises`, {
      headers,
      data: { name: n.exercise }
    })
    expect(r.status()).toBe(200)
    ids[n.exercise] = (await r.json()).exercise.id
  }
  const r = await request.post(`${API}/library/sequences`, {
    headers,
    data: {
      name,
      nodes: nodes.map(n => ({ exerciseId: ids[n.exercise], mode: n.mode, seconds: n.seconds }))
    }
  })
  expect(r.status()).toBe(200)
  return (await r.json()).sequence as { id: string; version: number }
}

/** Record every text the clock shows, from inside the page, so a 0 can't slip between polls. */
async function recordClock(page: Page) {
  await page.evaluate(() => {
    const seen: string[] = []
    ;(window as unknown as { __clockSeen: string[] }).__clockSeen = seen
    const note = () => {
      const t = document.querySelector('[data-testid="sequence-clock"]')?.textContent ?? ''
      if (t && seen[seen.length - 1] !== t) seen.push(t)
    }
    new MutationObserver(note).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true
    })
  })
}
const clockSeen = (page: Page) =>
  page.evaluate(() => (window as unknown as { __clockSeen: string[] }).__clockSeen)

const player = (page: Page) => page.getByTestId('sequence-player')

test.describe('sequences', () => {
  test('guest builds an exercise with a picture and a sequence, and plays it from the library', async ({
    page,
    request
  }) => {
    test.setTimeout(90_000)
    const raised: string[] = []
    page.on('dialog', d => {
      raised.push(d.type())
      void d.dismiss()
    })
    const user = newUser()
    await signInAs(page, 'guest', user)
    await page.goto('/')
    await expect(page.locator('.task-app__input')).toBeVisible()
    // A guest has no board storage, so no widgets — but the library is theirs.
    await expect(page.getByRole('button', { name: 'Add a widget' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Exercise library' }).click()
    const library = page.getByRole('dialog', { name: 'Exercise library' })
    await expect(library).toBeVisible()

    // Exercise, with a picture uploaded through the worker to the (fake) CDN.
    await library.getByRole('tab', { name: 'Exercises' }).click()
    await library.getByRole('button', { name: 'New exercise' }).click()
    const exDialog = page.getByRole('dialog', { name: 'New exercise' })
    await exDialog.getByLabel('Exercise name').fill('Wall sit')
    await exDialog.getByLabel('Exercise description').fill('Back flat, knees at 90°')
    await exDialog.getByLabel('Exercise picture').setInputFiles({
      name: 'wall-sit.png',
      mimeType: 'image/png',
      buffer: PNG
    })
    const preview = exDialog.getByTestId('exercise-picture')
    await expect(preview).toBeVisible()
    await expect
      .poll(() =>
        preview.evaluate(img => (img as unknown as { naturalWidth: number }).naturalWidth)
      )
      .toBe(2)
    await exDialog.getByRole('button', { name: 'Save exercise' }).click()
    await expect(exDialog).toHaveCount(0)
    await expect(
      library.getByTestId('library-exercise').filter({ hasText: 'Wall sit' })
    ).toBeVisible()

    // Sequence: the new exercise timed at 2 s, then itself again as a manual node.
    await library.getByRole('tab', { name: 'Sequences' }).click()
    await library.getByRole('button', { name: 'New sequence' }).click()
    const builder = page.getByRole('dialog', { name: 'New sequence' })
    await builder.getByLabel('Sequence name').fill('Quick legs')
    for (let i = 0; i < 2; i++) {
      await builder.getByRole('button', { name: 'Add exercise' }).click()
      const pick = page.getByRole('dialog', { name: 'Add an exercise' })
      await pick.getByLabel('Search exercises').fill('Wall')
      await pick.getByRole('button', { name: /Wall sit/ }).click()
      await expect(pick).toHaveCount(0)
    }
    await expect(builder.getByTestId('builder-node')).toHaveCount(2)
    await builder.getByLabel('Seconds for Wall sit').first().fill('2')
    await builder.getByTestId('builder-node').nth(1).getByRole('radio', { name: 'Manual' }).click()
    await expect(builder.getByText('2 exercises · about 0:12 + 1 untimed')).toBeVisible()
    await builder.getByRole('button', { name: 'Save sequence' }).click()
    await expect(builder).toHaveCount(0)

    // Play it: the player opens paused and waits.
    const row = library.locator('[data-testid="library-sequence"][data-sequence="Quick legs"]')
    await row.getByRole('button', { name: 'Play Quick legs' }).click()
    await expect(player(page)).toBeVisible()
    await expect(player(page)).toHaveAttribute('data-playing', 'false')
    await expect(page.getByTestId('sequence-clock')).toHaveText('Press play to start')
    await expect(page.getByTestId('sequence-exercise')).toHaveText('Wall sit')
    const img = player(page).locator('.sequence-player__media img')
    await expect
      .poll(() => img.evaluate(el => (el as unknown as { naturalWidth: number }).naturalWidth))
      .toBe(2)

    // The timer bar sits directly on top of the minimap.
    const bar = await page.getByTestId('sequence-bar').boundingBox()
    const map = await page.getByTestId('sequence-minimap').boundingBox()
    expect(bar && map && bar.y + bar.height <= map.y + 1 && bar.width >= map.width - 1).toBe(true)

    await recordClock(page)
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    // Node 1 counts down, goes, runs 2 s, and moves on by itself.
    await expect(player(page)).toHaveAttribute('data-index', '1', { timeout: 12_000 })
    // Node 2 (manual) counts down, then waits for Done.
    const done = page.getByRole('button', { name: 'Done — next' })
    await expect(done).toBeVisible({ timeout: 8_000 })
    await page.waitForTimeout(1500)
    await expect(player(page)).toHaveAttribute('data-index', '1')
    await done.click()
    await expect(page.getByTestId('sequence-done')).toContainText('2 of 2 exercises completed')

    const seen = await clockSeen(page)
    expect(seen.slice(0, 6)).toEqual(['5', '4', '3', '2', '1', 'Go!'])
    expect(seen).not.toContain('0')
    // A tick at 3, 2, 1 and the go sound, for each node, in order.
    await expect(player(page)).toHaveAttribute(
      'data-sounds',
      'tick3 tick2 tick1 go tick3 tick2 tick1 go'
    )

    // The run, as the server has it: both nodes completed, nothing else.
    await expect
      .poll(async () => {
        const runs = (
          await (await request.get(`${API}/sequence-runs`, { headers: as('guest', user) })).json()
        ).runs
        return (
          runs[0] &&
          `${runs[0].status} ${runs[0].complete} ${runs[0].nodes.map((n: { outcome: string }) => n.outcome).join(',')}`
        )
      })
      .toBe('completed true completed,completed')
    expect(raised).toEqual([])
  })

  test('a sequence on a board: Play opens it paused; skips, repeats and a stop are all logged', async ({
    page,
    request
  }) => {
    test.setTimeout(90_000)
    const user = newUser()
    const headers = as('member', user)
    const s = await seedSequence(request, headers, 'Core', [
      { exercise: 'Plank', mode: 'timed', seconds: 30 },
      { exercise: 'Side plank', mode: 'timed', seconds: 30 },
      { exercise: 'Hollow hold', mode: 'manual' }
    ])
    await signInAs(page, 'member', user)
    await page.goto('/')
    await expect(page.locator('.task-app__input')).toBeVisible()

    // A member has sequences but not trackers: the widget button goes straight to the library.
    await page.getByRole('button', { name: 'Add a widget' }).click()
    const pick = page.getByRole('dialog', { name: 'Add a sequence' })
    await pick
      .locator('[data-testid="library-sequence"][data-sequence="Core"]')
      .getByRole('button', { name: 'Add to board' })
      .click()
    await expect(pick).toHaveCount(0)
    const tile = page.locator('[data-testid="sequence-card"][data-sequence="Core"]')
    await expect(tile).toBeVisible()
    await expect(tile.getByTestId('sequence-last-run')).toHaveText('Not played yet')

    // The tile's button is Play, and the player waits for the user.
    await tile.getByRole('button', { name: 'Play Core' }).click()
    await expect(player(page)).toHaveAttribute('data-playing', 'false')
    await page.getByRole('button', { name: 'Play', exact: true }).click()
    await expect(player(page)).toHaveAttribute('data-phase', 'active', { timeout: 8_000 })
    // Skip Plank mid-exercise, go back to it, then skip forward twice via the minimap.
    await page.getByRole('button', { name: 'Skip' }).click()
    await expect(player(page)).toHaveAttribute('data-index', '1')
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(player(page)).toHaveAttribute('data-index', '0')
    await page.getByRole('button', { name: '3. Hollow hold' }).click()
    await expect(page.getByTestId('sequence-exercise')).toHaveText('Hollow hold')

    // Closing mid-run asks first, and "Stop" ends it.
    await page.getByRole('dialog', { name: 'Core' }).getByRole('button', { name: 'Close' }).click()
    const stopDialog = page.getByRole('dialog', { name: 'Stop this workout?' })
    await expect(stopDialog).toBeVisible()
    await expect(player(page)).toHaveAttribute('data-playing', 'false')
    await stopDialog.getByRole('button', { name: 'Stop' }).click()
    await expect(player(page)).toHaveCount(0)

    // Logged on the board: Plank skipped, rewound from Side plank, Plank skipped
    // again by the jump, then Hollow hold stopped. Side plank is never "completed".
    await expect(tile.getByTestId('sequence-last-run')).toHaveText('0/3 today', { timeout: 35_000 })
    const board = await (await request.get(`${API}/boards/main/sequences`, { headers })).json()
    const run = board.runs[0]
    expect(run.status).toBe('stopped')
    expect(run.complete).toBe(false)
    expect(
      run.nodes.map((n: { position: number; outcome: string }) => `${n.position}:${n.outcome}`)
    ).toEqual(['0:skipped', '1:rewound', '0:skipped', '2:stopped'])

    // The detail shows it, counting the repeat.
    await tile.getByRole('button', { name: 'Open Core' }).click()
    const detail = page.getByRole('dialog', { name: 'Core' })
    await expect(detail.getByTestId('sequence-runs')).toContainText(
      '0/3 done · 2 skipped · 1 repeated · stopped early'
    )

    // The author edits the sequence: the board keeps v1 until it updates.
    await detail.getByRole('button', { name: 'Close' }).click()
    const v1 = (await (await request.get(`${API}/library/sequences/${s.id}`, { headers })).json())
      .sequence
    const edit = await request.put(`${API}/library/sequences/${s.id}`, {
      headers,
      data: {
        name: 'Core',
        nodes: v1.nodes
          .slice(0, 2)
          .map((n: { exercise: { id: string }; mode: string; seconds: number }) => ({
            exerciseId: n.exercise.id,
            mode: n.mode,
            seconds: n.seconds
          }))
      }
    })
    expect(edit.status()).toBe(200)
    await page.reload()
    await expect(tile.getByTestId('sequence-last-run')).toContainText('update')
    await tile.getByRole('button', { name: 'Open Core' }).click()
    await expect(detail.getByRole('listitem').filter({ hasText: 'Hollow hold' })).toBeVisible()
    await detail.getByRole('button', { name: 'Update to v2' }).click()
    await expect(detail.getByRole('listitem').filter({ hasText: 'Hollow hold' })).toHaveCount(0)
    await expect(detail.getByRole('button', { name: 'Update to v2' })).toHaveCount(0)
  })

  test("someone else's sequence plays but can't be edited; its owner's delete leaves my board alone", async ({
    page,
    request
  }) => {
    const author = newUser()
    const me = newUser()
    await seedSequence(request, as('friend', author), 'Shared stretch', [
      { exercise: 'Hamstring stretch', mode: 'timed', seconds: 20 }
    ])
    await signInAs(page, 'friend', me)
    await page.goto('/')
    await page.getByRole('button', { name: 'Exercise library' }).click()
    const library = page.getByRole('dialog', { name: 'Exercise library' })
    const row = library.locator('[data-testid="library-sequence"][data-sequence="Shared stretch"]')
    await expect(row).toContainText('shared')
    await expect(row.getByRole('button', { name: 'Play Shared stretch' })).toBeVisible()
    await expect(row.getByRole('button', { name: 'Edit Shared stretch' })).toHaveCount(0)
    await expect(row.getByRole('button', { name: 'Delete Shared stretch' })).toHaveCount(0)
    await library.getByRole('button', { name: 'Close' }).click()
    await expect(library).toHaveCount(0)

    // Put it on my board, then the author deletes it from the library.
    await page.getByRole('button', { name: 'Add a widget' }).click()
    await page
      .getByRole('dialog', { name: 'Add a sequence' })
      .locator('[data-testid="library-sequence"][data-sequence="Shared stretch"]')
      .getByRole('button', { name: 'Add to board' })
      .click()
    const tile = page.locator('[data-testid="sequence-card"][data-sequence="Shared stretch"]')
    await expect(tile).toBeVisible()
    const list = (
      await (
        await request.get(`${API}/library/sequences`, { headers: as('friend', author) })
      ).json()
    ).sequences as Array<{ id: string; name: string }>
    const del = await request.delete(
      `${API}/library/sequences/${list.find(x => x.name === 'Shared stretch')?.id}`,
      { headers: as('friend', author) }
    )
    expect(del.status()).toBe(200)
    await page.reload()
    await expect(tile).toBeVisible()
    await tile.getByRole('button', { name: 'Play Shared stretch' }).click()
    await expect(page.getByTestId('sequence-exercise')).toHaveText('Hamstring stretch')
  })
})
