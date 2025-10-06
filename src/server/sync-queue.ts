/**
 * GitHub Sync Queue
 * Manages batching of file updates to GitHub API
 */

import type { GitHubConfig, DataType, UserType } from './types'
import { readUserData } from './storage'

const GHP = 'https://api.github.com'

/**
 * Get file from GitHub
 */
async function ghGetFile(
  path: string,
  config: GitHubConfig
): Promise<{ text: string; sha: string }> {
  const url = `${GHP}/repos/${config.owner}/${config.repo}/contents/${path}?ref=${config.branch}`
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${config.token}`
    }
  })
  
  if (!response.ok) {
    throw new Error(`GET ${path} ${response.status}`)
  }
  
  const json: any = await response.json()
  const content = Buffer.from(json.content, 'base64').toString('utf-8')
  
  return { text: content, sha: json.sha }
}

/**
 * Put file to GitHub
 */
async function ghPutFile(
  path: string,
  text: string,
  config: GitHubConfig,
  sha?: string,
  message = 'update data'
): Promise<any> {
  const url = `${GHP}/repos/${config.owner}/${config.repo}/contents/${path}`
  const body = {
    message,
    content: Buffer.from(text, 'utf-8').toString('base64'),
    branch: config.branch,
    ...(sha ? { sha } : {})
  }
  
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  
  if (!response.ok) {
    throw new Error(`PUT ${path} ${response.status}`)
  }
  
  return response.json()
}

/**
 * Sync Queue class
 * Tracks which files need to be synced to GitHub
 */
export class SyncQueue {
  private queue: Set<string> = new Set()
  
  /**
   * Add a file to the sync queue
   */
  add(userType: UserType, dataType: DataType): void {
    const key = `${userType}:${dataType}`
    this.queue.add(key)
    console.log(`📋 Queued for sync: ${key}`)
  }
  
  /**
   * Get the number of items in the queue
   */
  size(): number {
    return this.queue.size
  }
  
  /**
   * Clear the queue without syncing
   */
  clear(): void {
    this.queue.clear()
  }
  
  /**
   * Flush all queued files to GitHub
   */
  async flush(basePath: string, githubConfig?: GitHubConfig): Promise<void> {
    if (!githubConfig) {
      console.log('⏭️  No GitHub config, skipping sync')
      return
    }
    
    if (this.queue.size === 0) {
      console.log('✅ Sync queue empty, nothing to do')
      return
    }
    
    console.log(`🔄 Syncing ${this.queue.size} file(s) to GitHub...`)
    
    const items = Array.from(this.queue)
    
    for (const key of items) {
      try {
        const [userType, dataType] = key.split(':') as [UserType, DataType]
        const filePath = `task/data/${userType}/${dataType}.json`
        
        // Read local file content
        const localData = readUserData(userType, dataType, basePath)
        const localContent = JSON.stringify(localData, null, 2)
        
        // Get current SHA from GitHub
        let sha: string | undefined
        try {
          const ghFile = await ghGetFile(filePath, githubConfig)
          sha = ghFile.sha
        } catch (error) {
          // File doesn't exist on GitHub yet, that's ok
          console.log(`  ℹ️  File doesn't exist on GitHub yet: ${filePath}`)
        }
        
        // Push to GitHub
        await ghPutFile(filePath, localContent, githubConfig, sha, `task: update ${dataType} for ${userType}`)
        console.log(`  ✓ Synced: ${filePath}`)
        
        // Remove from queue
        this.queue.delete(key)
      } catch (error) {
        console.error(`  ✗ Failed to sync ${key}:`, error)
        // Keep in queue for retry
      }
    }
    
    if (this.queue.size === 0) {
      console.log('✅ Sync complete')
    } else {
      console.log(`⚠️  ${this.queue.size} file(s) failed to sync, will retry later`)
    }
  }
}
