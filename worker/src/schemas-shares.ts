/**
 * Zod schemas for board share management (§7) — the request/response bodies of
 * routes/shares.ts. Kept apart from schemas-agent.ts so the share UI does not
 * load the agent and automation schemas.
 */
import { z } from '@hono/zod-openapi'

export const GrantShareInputSchema = z
  .object({
    name: z.string().optional().openapi({
      example: 'tenhands-service',
      description:
        'Grantee display name (PREFERRED — no credential changes hands). Resolved case-insensitively against live registry rows.'
    }),
    key: z.string().optional().openapi({
      example: 'friend-…',
      description: 'Grantee access key — a bearer credential; prefer `name`.'
    }),
    // `userId` was here, and accepting it was the defect. A userId in a request
    // body is a CLAIM: it can be a display name someone read in a doc comment,
    // or a well-formed UUID belonging to nobody, and neither is distinguishable
    // from a real one without asking the registry. It went straight through
    // unlooked-up. See docs/architecture/IDENTITY_MODEL.md (R5) in hadoku_site.
    // Grant by `name`; it is what a human actually has.
    level: z.enum(['readonly', 'contributor']).openapi({ example: 'contributor' })
  })
  .openapi('GrantShareInput')

export const GrantShareResponseSchema = z
  .object({
    ok: z.boolean(),
    granteeUserId: z.string(),
    granteeName: z.string().nullable().optional(),
    level: z.enum(['readonly', 'contributor']),
    granted: z
      .object({
        name: z.string().nullable(),
        tier: z.string().nullable(),
        level: z.enum(['readonly', 'contributor'])
      })
      .openapi({
        description: 'Echo of what was granted, so the owner can confirm the identity + tier.'
      })
  })
  .openapi('GrantShareResponse')

export const UserSearchResponseSchema = z
  .object({
    users: z.array(
      z.object({
        name: z.string().openapi({ example: 'tenhands-service' }),
        tier: z.string().optional().openapi({ example: 'service' })
      })
    )
  })
  .openapi('UserSearchResponse')

export const ShareRowSchema = z
  .object({
    granteeUserId: z.string(),
    name: z
      .string()
      .nullable()
      .optional()
      .openapi({ description: 'Grantee display name (resolved from the registry).' }),
    tier: z.string().nullable().optional(),
    level: z.enum(['readonly', 'contributor']),
    createdAt: z.string()
  })
  .openapi('ShareRow')

export const ListSharesResponseSchema = z
  .object({ shares: z.array(ShareRowSchema) })
  .openapi('ListSharesResponse')

export const LeaveShareResponseSchema = z
  .object({ ok: z.boolean(), left: z.boolean() })
  .openapi('LeaveShareResponse')

export const RevokeShareResponseSchema = z
  .object({ ok: z.boolean(), removed: z.boolean() })
  .openapi('RevokeShareResponse')
