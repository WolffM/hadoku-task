/**
 * The response-content wrappers and the `ref` path param the automation routes
 * share. Small, but referenced from every group, so they live in one place
 * rather than being duplicated per module.
 */
import { z } from '@hono/zod-openapi'
import {
  ForbiddenErrorSchema,
  BoardNotFoundErrorSchema,
  DigestMismatchErrorSchema,
  LaneSetInvalidErrorSchema
} from '../schemas-agent'

// Narrowed to the codes each (route, status) can actually emit — see agent.ts.
export const forbidden = { 'application/json': { schema: ForbiddenErrorSchema } }
export const boardNotFound = { 'application/json': { schema: BoardNotFoundErrorSchema } }
export const digestMismatch = { 'application/json': { schema: DigestMismatchErrorSchema } }
export const laneSetInvalid = { 'application/json': { schema: LaneSetInvalidErrorSchema } }
export const refParam = z.object({
  ref: z.string().openapi({ param: { name: 'ref', in: 'path' }, example: 'main' })
})
