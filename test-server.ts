/**
 * Test Server - Minimal implementation using the new router
 * This demonstrates how to use the Task Router in production
 */

import express from 'express'
import cors from 'cors'
import { createTaskRouter } from './src/server/router.js'

const app = express()
app.use(cors())
app.use(express.json())

// Disable buffering and enable immediate response flushing
app.use((req, res, next) => {
  res.setHeader('X-Accel-Buffering', 'no')
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
  next()
})

// Create the task router with local data path
const taskRouter = createTaskRouter({
  dataPath: './task/data',
  githubConfig: process.env.GITHUB_TOKEN ? {
    owner: 'WolffM',
    repo: 'hadoku-task',
    branch: 'main',
    token: process.env.GITHUB_TOKEN
  } : undefined
})

// Mount using nested Express app pattern (stable client contract)
const taskApp = express()
taskApp.use('/api', taskRouter)
app.use('/task', taskApp)

// Graceful shutdown: flush queue before exit
process.on('SIGTERM', async () => {
  console.log('🛑 SIGTERM received, flushing sync queue...')
  await taskRouter.syncQueue.flush(taskRouter.config.dataPath, taskRouter.config.githubConfig)
  process.exit(0)
})

process.on('SIGINT', async () => {
  console.log('🛑 SIGINT received, flushing sync queue...')
  await taskRouter.syncQueue.flush(taskRouter.config.dataPath, taskRouter.config.githubConfig)
  process.exit(0)
})

// Redirect root to test.html
app.get('/', (req, res) => {
  res.redirect('/test.html')
})

// Serve static files from root directory for test.html
app.use(express.static('.'))

const PORT = 3001

app.listen(PORT, '127.0.0.1', () => {
  console.log(`✅ Test server running on http://127.0.0.1:${PORT}`)
  console.log(`📝 Open http://127.0.0.1:${PORT} to test the app`)
  console.log(`🔧 Using Task Router from src/server/router.ts`)
  console.log(`📊 Sync queue size: ${taskRouter.syncQueue.size()}`)
})
