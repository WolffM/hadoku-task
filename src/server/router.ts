/**
 * Task Management Express Router
 * Main entry point for the Task API - now using framework-agnostic handlers
 */

import { Router } from 'express'
import type { RouterConfig } from '../domain/types.js'
import { ensureUserDataExists, createStorage } from './storage.js'
import { SyncQueue } from './sync-queue.js'
import { createTaskRoutes } from './routes-adapter.js'

export interface TaskRouter extends Router {
  syncQueue: SyncQueue
  config: RouterConfig
}

/**
 * Create and configure the Task router
 * This is now a thin adapter that connects Express to the framework-agnostic handlers
 */
export function createTaskRouter(config: RouterConfig): TaskRouter {
  const router = Router() as TaskRouter
  const syncQueue = new SyncQueue()
  
  // Attach sync queue and config to router
  router.syncQueue = syncQueue
  router.config = config
  
  // Ensure friend/admin data directories exist
  ensureUserDataExists('friend', config.dataPath)
  ensureUserDataExists('admin', config.dataPath)
  
  // Create storage that implements Storage interface
  const storage = createStorage(config, syncQueue)
  
  // Mount routes (thin adapter layer using api/ handlers)
  router.use('/', createTaskRoutes(storage))
  
  return router
}
