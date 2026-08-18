/** Key validation — the one method that is neither board- nor task-scoped. */
import { logger } from '@wolffm/logger/client'
import { formatError } from '../domain/utils/tags'
import { type ApiCtx } from './client-context'

// Takes the context for a uniform composition signature; validateKey is the
// one method that needs nothing from it.
export function miscMethods(_ctx: ApiCtx) {
  return {
    // User Management
    async validateKey(key: string): Promise<boolean> {
      logger.info('[api] validateKey: Starting')
      try {
        const response = await fetch('/task/api/validate-key', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-Key': key
          }
        })
        const isValid = response.ok
        logger.info('[api] validateKey: Completed', { isValid })
        return isValid
      } catch (err) {
        logger.error('[api] validateKey: Failed', {
          error: formatError(err)
        })
        return false
      }
    }
  }
}
