import type { Page } from '@playwright/test'

/** A board as the boards endpoint serves it. */
export interface MockBoard {
  id: string
  name: string
  tasks: unknown[]
  tags: unknown[]
}

export const MAIN_BOARD: MockBoard = { id: 'main', name: 'Main', tasks: [], tags: [] }

/**
 * The two routes a spec must answer before the app shell will render at all:
 * the session handshake and the boards list. Neither is what these specs are
 * testing — they are the price of getting to the thing under test — so they are
 * one helper rather than a block pasted into every file.
 *
 * Deliberately NOT for specs that assert ON these responses. A spec exercising
 * handshake failure, session identity, board-switch races or request ordering
 * owns its own mock, because the shape of that mock IS the test. This one only
 * serves the boring default: an anonymous session with no stored preferences,
 * and a single board named Main.
 *
 * Prefs are not mocked here or anywhere — see `helpers/prefs.ts`.
 */
export async function mockShellApi(page: Page, boards: MockBoard[] = [MAIN_BOARD]): Promise<void> {
  await page.route('**/task/api/session/handshake', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ preferences: null })
    })
  )

  await page.route('**/task/api/boards*', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        version: 1,
        updatedAt: new Date().toISOString(),
        boards
      })
    })
  )
}
