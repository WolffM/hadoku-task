/**
 * Stateless Streamable-HTTP MCP endpoint for the task service.
 *
 * Implements the MCP JSON-RPC surface (initialize, tools/list, tools/call, ping)
 * over a single POST per request — no sessions, no Durable Objects, so it's cheap
 * and reuses the worker's in-process handlers + KV/D1. Auth/scoping comes from the
 * worker's authContext (sessionId = X-User-Key), identical to /task/api/*.
 *
 * GET returns 405: this stateless server offers no server->client SSE stream;
 * compliant clients fall back to POST request/response.
 */

import type { Context } from 'hono'
import type { AppContext } from '../types'
import { createKVStorage } from '../routes/route-utils'
import { DEFAULT_BOARD_ID } from '../constants'
import { TOOLS, callTool, type ToolCtx } from './tools'

const DEFAULT_PROTOCOL = '2024-11-05'
const SERVER_INFO = { name: 'hadoku-task', version: '1.0.0' }

interface JsonRpcMessage {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

const ok = (id: string | number, result: unknown) => ({ jsonrpc: '2.0', id, result })
const err = (id: string | number | null, code: number, message: string) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message }
})

export async function handleMcp(c: Context<AppContext>): Promise<Response> {
  const auth = c.get('authContext')
  const ctx: ToolCtx = {
    // legacyId enables dual-read + read-repair of the pre-flip raw-key namespace,
    // so MCP callers see the same migrated data as the HTTP routes.
    storage: createKVStorage(c.env, auth?.legacyId),
    auth,
    defaultBoard: DEFAULT_BOARD_ID
  }

  let payload: JsonRpcMessage | JsonRpcMessage[]
  try {
    payload = await c.req.json()
  } catch {
    return c.json(err(null, -32700, 'Parse error'), 400)
  }

  const handleOne = async (msg: JsonRpcMessage): Promise<object | null> => {
    const { id, method, params } = msg
    const isNotification = id === undefined || id === null
    const reqId = (id ?? 0) as string | number

    try {
      switch (method) {
        case 'initialize':
          return ok(reqId, {
            protocolVersion: (params?.protocolVersion as string) || DEFAULT_PROTOCOL,
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO
          })
        case 'tools/list':
          return ok(reqId, {
            tools: TOOLS.map(({ name, description, inputSchema }) => ({
              name,
              description,
              inputSchema
            }))
          })
        case 'tools/call': {
          const name = params?.name as string
          const args = (params?.arguments as Record<string, unknown>) ?? {}
          try {
            const out = await callTool(name, args, ctx)
            return ok(reqId, {
              content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
              structuredContent: out
            })
          } catch (toolErr) {
            // Tool execution errors are returned as a result with isError (per MCP),
            // so the model sees them rather than the connection failing.
            const message = toolErr instanceof Error ? toolErr.message : String(toolErr)
            return ok(reqId, {
              content: [{ type: 'text', text: `Error: ${message}` }],
              isError: true
            })
          }
        }
        case 'ping':
          return ok(reqId, {})
        default:
          // Notifications (incl. notifications/initialized) get no response.
          if (isNotification) return null
          return err(reqId, -32601, `Method not found: ${method}`)
      }
    } catch (e) {
      if (isNotification) return null
      return err(reqId, -32603, e instanceof Error ? e.message : String(e))
    }
  }

  if (Array.isArray(payload)) {
    const responses = (await Promise.all(payload.map(handleOne))).filter(Boolean)
    return responses.length ? c.json(responses) : new Response(null, { status: 202 })
  }
  const response = await handleOne(payload)
  return response ? c.json(response) : new Response(null, { status: 202 })
}
