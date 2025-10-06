/**
 * Task Operation Routes - Complete, Update, Delete
 */

import { Router, type Request, type Response } from 'express'
import type { UserType } from '../types'
import { DataAccess } from '../handlers/data-access'
import * as TaskOps from '../handlers/task-operations'
import { createISO } from '../utils'

export function createTaskOperationRoutes(dataAccess: DataAccess): Router {
  const router = Router()

  /**
   * POST /:id/complete - Mark task as completed
   * Header: X-User-Type: public|friend|admin
   */
  router.post('/:id/complete', (req: Request, res: Response) => {
    try {
      const userType = (req.headers['x-user-type'] as UserType) || 'public'
      const { id } = req.params
      const now = createISO()

      const data = dataAccess.getData(userType)
      const result = TaskOps.completeTask(data.tasks, data.stats, id, now)

      if (!result) {
        return res.status(404).json({ error: 'Not found' })
      }

      dataAccess.setData(userType, result)
      res.json({ ok: true })
    } catch (error) {
      console.error('POST /:id/complete error:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  /**
   * PATCH /:id - Update task
   * Header: X-User-Type: public|friend|admin
   * Body: { title?, tag?, completed? }
   */
  router.patch('/:id', (req: Request, res: Response) => {
    try {
      const userType = (req.headers['x-user-type'] as UserType) || 'public'
      const { id } = req.params
      const patch = req.body
      const now = createISO()

      const data = dataAccess.getData(userType)
      const result = TaskOps.updateTask(data.tasks, data.stats, id, patch, now)

      if (!result) {
        return res.status(404).json({ error: 'Not found' })
      }

      dataAccess.setData(userType, result)
      res.json({ ok: true })
    } catch (error) {
      console.error('PATCH /:id error:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  /**
   * DELETE /:id - Delete task
   * Header: X-User-Type: public|friend|admin
   */
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const userType = (req.headers['x-user-type'] as UserType) || 'public'
      const { id } = req.params
      const now = createISO()

      const data = dataAccess.getData(userType)
      const result = TaskOps.deleteTask(data.tasks, data.stats, id, now)

      if (!result) {
        return res.status(404).json({ error: 'Not found' })
      }

      dataAccess.setData(userType, result)
      res.json({ ok: true })
    } catch (error) {
      console.error('DELETE /:id error:', error)
      res.status(500).json({ error: String(error) })
    }
  })

  return router
}
