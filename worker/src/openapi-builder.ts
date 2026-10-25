/**
 * Build /task/api/openapi.json — at BUILD time, never on the request path.
 *
 * Every group merged onto one app, the way they were all mounted before they
 * went lazy, then serialized exactly as `doc()` would answer (`c.json` of
 * `getOpenAPIDocument`). That is all ~650 zod nodes plus a registry walk:
 * 90–250 ms of CPU, which the worker used to pay on every fetch, and TenHands
 * fetches it hourly (#103). The document is a pure function of the source, so
 * `pnpm run gen:spec` runs this once and root serves the bytes
 * (openapi-spec.ts); openapi-spec-verify.ts fails when they drift.
 *
 * Imported only by the generator and the harnesses. Root must not import it.
 */
import { OpenAPIHono } from '@hono/zod-openapi'
import { createOpenAPIDocConfig } from '@wolffm/worker-utils'
import { ROUTE_GROUPS, type RouteGroup } from './route-groups'
import { DomainErrorSchema } from './schemas-errors'
import type { AppContext } from './types'

export async function buildOpenAPISpec(): Promise<string> {
  const spec = new OpenAPIHono<AppContext>()
  for (const group of Object.keys(ROUTE_GROUPS) as RouteGroup[]) {
    spec.route('/task/api', await ROUTE_GROUPS[group]())
  }

  // Every documented error response is narrowed to the codes ITS route+status can
  // emit, so nothing references the catch-all any more. Register it explicitly:
  // a generated client still needs the full `DomainErrorCode` enum and a base type
  // for statuses no route declares (429 RATE_LIMITED from the throttle, 500).
  spec.openAPIRegistry.register('DomainError', DomainErrorSchema)

  const document = spec.getOpenAPIDocument(
    createOpenAPIDocConfig({
      title: 'Task API',
      version: '1.0.0',
      description: `
API for managing tasks, boards, and user preferences.

## Overview
This API provides endpoints for:
- **Tasks**: Create, read, update, delete, and complete tasks
- **Boards**: Organize tasks into boards
- **Tags**: Categorize tasks with tags
- **Batch Operations**: Bulk updates for tags and task movement
- **Preferences**: User settings and configuration
- **Sessions**: Session management and handshake

## Authentication
- **Public endpoints**: Basic read access without authentication
- **Authenticated endpoints**: Full access via X-User-Key header
- User types: admin, friend, public

## Rate Limiting
- Public users are rate-limited to prevent abuse
- Authenticated users (admin/friend) bypass rate limiting
		`,
      production: 'https://task-api.hadoku.workers.dev',
      tags: [
        { name: 'Health', description: 'Health check endpoints' },
        { name: 'Tasks', description: 'Task CRUD operations' },
        { name: 'Boards', description: 'Board management' },
        { name: 'Tags', description: 'Tag management' },
        { name: 'Batch', description: 'Batch operations' },
        { name: 'Session', description: 'Session management' },
        { name: 'Preferences', description: 'User preferences' },
        { name: 'Admin', description: 'Admin operations (requires admin access)' },
        {
          name: 'Theme editor',
          description: 'Read and commit theme tokens for hadoku.me/task/editor (service tier+)'
        }
      ]
    })
  )
  return JSON.stringify(document)
}
