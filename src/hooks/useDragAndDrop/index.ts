/**
 * Hook for managing drag and drop functionality
 */

import React, { useState, useRef } from 'react'
import { useEffect } from 'react'
import type { Task } from '../../domain/types'
import { logger } from '@wolffm/task-ui-components'

interface UseDragAndDropProps {
  tasks: Task[]
  onTaskUpdate: (taskId: string, updates: { tag: string }) => Promise<void>
  onBulkUpdate: (updates: Array<{ taskId: string; tag: string }>) => Promise<void>
}

export function useDragAndDrop({
  tasks,
  onTaskUpdate: _onTaskUpdate,
  onBulkUpdate
}: UseDragAndDropProps) {
  const [dragOverTag, setDragOverTag] = useState<string | null>(null)
  const [dragOverFilter, setDragOverFilter] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isSelecting, setIsSelecting] = useState(false)
  const [marqueeRect, setMarqueeRect] = useState<{
    x: number
    y: number
    w: number
    h: number
  } | null>(null)
  const [selectionJustEndedAt, setSelectionJustEndedAt] = useState<number | null>(null)
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null)

  /**
   * Extract dragged task IDs from drag event
   * Supports multi-task drag via custom data format, falls back to single ID
   */
  function extractDraggedTaskIds(e: React.DragEvent): string[] {
    let ids: string[] = []

    // Try to read multi-task IDs first
    try {
      const raw = e.dataTransfer.getData('application/x-hadoku-task-ids')
      if (raw) ids = JSON.parse(raw)
    } catch {
      /* Intentionally ignore errors */
    }

    // Fallback to single task ID
    if (ids.length === 0) {
      const taskId = e.dataTransfer.getData('text/plain')
      if (taskId) ids = [taskId]
    }

    return ids
  }

  function onDragStart(e: React.DragEvent, taskId: string) {
    const idsToDrag =
      selectedIds.has(taskId) && selectedIds.size > 0 ? Array.from(selectedIds) : [taskId]
    logger.info('[useDragAndDrop] onDragStart', {
      taskId,
      idsToDrag,
      selectedCount: selectedIds.size
    })
    e.dataTransfer.setData('text/plain', idsToDrag[0])
    try {
      e.dataTransfer.setData('application/x-hadoku-task-ids', JSON.stringify(idsToDrag))
    } catch {
      /* Intentionally ignore errors */
    }
    e.dataTransfer.effectAllowed = 'copyMove'

    try {
      // Find the task row element in case the event target is an inner element
      const elTarget = e.currentTarget as HTMLElement
      const el =
        elTarget.closest && elTarget.closest('.task-app__item')
          ? (elTarget.closest('.task-app__item') as HTMLElement)
          : elTarget
      // Add dragging class for CSS animations
      el.classList.add('dragging')

      // Create a clone for a custom drag image
      const clone = el.cloneNode(true) as HTMLElement
      clone.style.boxSizing = 'border-box'
      clone.style.width = `${el.offsetWidth}px`
      clone.style.height = `${el.offsetHeight}px`
      clone.style.opacity = '0.95'
      // Do not scale the clone: keep 1:1 so setDragImage offsets are exact
      clone.style.transform = 'none'
      clone.style.filter = 'drop-shadow(0 6px 18px rgba(0,0,0,0.12))'
      clone.classList.add('drag-image')
      // Position off-screen but present in DOM
      clone.style.position = 'absolute'
      clone.style.top = '-9999px'
      clone.style.left = '-9999px'
      document.body.appendChild(clone)

      // Store reference so we can remove it on dragend
      ;(el as HTMLElement & { __dragImage?: HTMLElement }).__dragImage = clone

      // ensure selection includes the dragged item
      setSelectedIds(prev => {
        if (prev.has(taskId)) return new Set(prev)
        const copy = new Set(prev)
        copy.add(taskId)
        return copy
      })

      // If the drag started inside a tag-column, include the source tag
      try {
        const col = el.closest('.task-app__tag-column') as HTMLElement | null
        if (col) {
          const hdr = col.querySelector('.task-app__tag-header') || col.querySelector('h3')
          const txt = hdr ? hdr.textContent || '' : ''
          // header looks like "#tag"
          const srcTag = txt.trim().replace(/^#/, '')
          if (srcTag) {
            try {
              e.dataTransfer.setData('application/x-hadoku-task-source', srcTag)
            } catch {
              /* Intentionally ignore errors */
            }
          }
        }
      } catch {
        /* Intentionally ignore errors */
      }

      // Use the clone as drag image and align it so the cursor remains at the same
      // relative position within the row as when the drag started.
      try {
        const rect = el.getBoundingClientRect()
        // Use the exact click point offset inside the element so the drag image aligns exactly
        const mouseEvent = e as React.DragEvent & { clientX: number; clientY: number }
        let offsetX = Math.round(mouseEvent.clientX - rect.left)
        let offsetY = Math.round(mouseEvent.clientY - rect.top)
        // Clamp offsets to clone dimensions
        offsetX = Math.max(0, Math.min(Math.round(clone.offsetWidth - 1), offsetX))
        offsetY = Math.max(0, Math.min(Math.round(clone.offsetHeight - 1), offsetY))
        e.dataTransfer.setDragImage(clone, offsetX, offsetY)
      } catch {
        e.dataTransfer.setDragImage(clone, 0, 0)
      }
    } catch {
      // Ignore if drag image not allowed
    }
  }

  function onDragEnd(e: React.DragEvent) {
    try {
      const el = e.currentTarget as HTMLElement & { __dragImage?: HTMLElement }
      el.classList.remove('dragging')
      const clone = el.__dragImage
      if (clone?.parentNode) clone.parentNode.removeChild(clone)
      if (clone) delete el.__dragImage
    } catch {
      /* Intentionally ignore errors */
    }
    // Remove clone and clear selection after any drag completes
    try {
      clearSelection()
    } catch {
      /* Intentionally ignore errors */
    }
  }

  // Selection marquee handlers
  function selectionStartHandler(e: React.MouseEvent) {
    // Only left mouse button
    if (e.button !== 0) return
    // Only start marquee when the user begins on whitespace/background.
    // If the mousedown originates from an interactive element (task row, controls,
    // filters, board buttons, inputs, buttons), we don't start the marquee so
    // the click/drag behaves like normal text selection or item drag.
    try {
      const tg = e.target as HTMLElement
      if (!tg) return
      // Do not start when clicking inside a task item or direct interactive controls
      // Allow starting inside tag columns (empty areas) so box-select works there.
      const interactiveSelector =
        '.task-app__item, .task-app__controls, button, input, textarea, .task-app__item-actions'
      if (tg.closest && tg.closest(interactiveSelector)) {
        return
      }
    } catch {
      /* Intentionally ignore errors */
    }
    setIsSelecting(true)
    selectionStartRef.current = { x: e.clientX, y: e.clientY }
    setMarqueeRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 })
    // clear previous selection
    setSelectedIds(new Set())
    // Disable native text selection while marquee is active
    try {
      document.body.classList.add('marquee-selecting')
    } catch {
      /* Intentionally ignore errors */
    }
  }

  function selectionMoveHandler(e: React.MouseEvent) {
    if (!isSelecting || !selectionStartRef.current) return
    const x1 = selectionStartRef.current.x
    const y1 = selectionStartRef.current.y
    const x2 = e.clientX
    const y2 = e.clientY
    const left = Math.min(x1, x2)
    const top = Math.min(y1, y2)
    const w = Math.abs(x2 - x1)
    const h = Math.abs(y2 - y1)
    setMarqueeRect({ x: left, y: top, w, h })

    // Hit-test items
    const items = Array.from(document.querySelectorAll('.task-app__item')) as HTMLElement[]
    const newSel = new Set<string>()
    for (const it of items) {
      const rect = it.getBoundingClientRect()
      const overlap = !(
        rect.right < left ||
        rect.left > left + w ||
        rect.bottom < top ||
        rect.top > top + h
      )
      if (overlap) {
        const id = it.getAttribute('data-task-id')
        if (id) newSel.add(id)
        it.classList.add('selected')
      } else {
        it.classList.remove('selected')
      }
    }
    setSelectedIds(newSel)
  }

  function selectionEndHandler(_e: React.MouseEvent) {
    setIsSelecting(false)
    setMarqueeRect(null)
    selectionStartRef.current = null
    try {
      document.body.classList.remove('marquee-selecting')
    } catch {
      /* Intentionally ignore errors */
    }
    try {
      setSelectionJustEndedAt(Date.now())
    } catch {
      /* Intentionally ignore errors */
    }
  }

  function clearSelection() {
    setSelectedIds(new Set())
    const items = Array.from(document.querySelectorAll('.task-app__item.selected')) as HTMLElement[]
    items.forEach(it => it.classList.remove('selected'))
  }

  // Global listeners so marquee can start even if initial mousedown is outside the app
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      // Forward to our handler if left button
      if (e.button !== 0) return
      // Create a synthetic React-like event wrapper with minimal properties
      const fake = {
        target: e.target,
        clientX: e.clientX,
        clientY: e.clientY,
        button: e.button
      } as unknown as React.MouseEvent
      try {
        selectionStartHandler(fake)
      } catch {
        /* Intentionally ignore errors */
      }
    }

    function onDocMouseMove(e: MouseEvent) {
      const fake = { clientX: e.clientX, clientY: e.clientY } as unknown as React.MouseEvent
      try {
        selectionMoveHandler(fake)
      } catch {
        /* Intentionally ignore errors */
      }
    }

    function onDocMouseUp(e: MouseEvent) {
      const fake = { clientX: e.clientX, clientY: e.clientY } as unknown as React.MouseEvent
      try {
        selectionEndHandler(fake)
      } catch {
        /* Intentionally ignore errors */
      }
    }

    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('mousemove', onDocMouseMove)
    document.addEventListener('mouseup', onDocMouseUp)

    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('mousemove', onDocMouseMove)
      document.removeEventListener('mouseup', onDocMouseUp)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onDragOver(e: React.DragEvent, targetTag: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOverTag(targetTag)
  }

  function onDragLeave(e: React.DragEvent) {
    // Only clear if we're actually leaving the drop zone
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverTag(null)
    }
  }

  async function onDrop(e: React.DragEvent, targetTag: string) {
    e.preventDefault()
    setDragOverTag(null)
    logger.info('[useDragAndDrop] onDrop START', { targetTag })

    // Extract dragged task IDs (supports multi-task drag)
    const ids = extractDraggedTaskIds(e)
    if (ids.length === 0) return

    // read source tag if provided
    let srcTag: string | null = null
    try {
      const s = e.dataTransfer.getData('application/x-hadoku-task-source')
      if (s) srcTag = s
    } catch {
      /* Intentionally ignore errors */
    }
    logger.info('[useDragAndDrop] onDrop: processing', {
      targetTag,
      ids,
      srcTag,
      taskCount: ids.length
    })

    // Build list of tag updates
    const updates: Array<{ taskId: string; tag: string }> = []
    for (const id of ids) {
      const task = tasks.find(t => t.id === id)
      if (!task) continue
      const existingTags = task.tag?.split(' ').filter(Boolean) || []

      if (targetTag === 'other') {
        // remove all tags
        if (existingTags.length === 0) continue
        updates.push({ taskId: id, tag: '' })
        continue
      }

      // Add targetTag if missing
      const hasTarget = existingTags.includes(targetTag)

      // If drag source specified and different from target, remove srcTag if present
      let newTags = existingTags.slice()
      if (!hasTarget) newTags.push(targetTag)
      if (srcTag && srcTag !== targetTag) {
        newTags = newTags.filter(t => t !== srcTag)
      }

      const updatedTags = newTags.join(' ').trim()
      updates.push({ taskId: id, tag: updatedTags })
    }

    logger.info('[useDragAndDrop] onDrop: updating tasks', { updateCount: updates.length })
    try {
      // Use bulk update for efficiency - suppresses individual broadcasts and reloads
      await onBulkUpdate(updates)
      logger.info('[useDragAndDrop] onDrop: updates complete, clearing selection')
      // clear selection after successful tag updates
      try {
        clearSelection()
      } catch {
        /* Intentionally ignore errors */
      }
    } catch (error) {
      logger.error('[useDragAndDrop] Failed to add tag to one or more tasks', {
        error: error instanceof Error ? error.message : String(error)
      })
      alert((error as Error).message || 'Failed to add tags')
    }
    logger.info('[useDragAndDrop] onDrop END')
  }

  function onFilterDragOver(e: React.DragEvent, filterTag: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setDragOverFilter(filterTag)
  }

  function onFilterDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverFilter(null)
    }
  }

  async function onFilterDrop(e: React.DragEvent, filterTag: string) {
    e.preventDefault()
    setDragOverFilter(null)

    // Extract dragged task IDs (supports multi-task drag)
    const ids = extractDraggedTaskIds(e)
    if (ids.length === 0) return

    logger.info('[useDragAndDrop] onFilterDrop', { filterTag, ids, taskCount: ids.length })

    // Build list of tag updates
    const updates: Array<{ taskId: string; tag: string }> = []
    for (const id of ids) {
      const task = tasks.find(t => t.id === id)
      if (!task) continue

      const existingTags = task.tag?.split(' ').filter(Boolean) || []
      if (existingTags.includes(filterTag)) {
        logger.info('[useDragAndDrop] Task already has tag', { taskId: id, filterTag })
        continue // Tag already exists
      }

      const updatedTags = [...existingTags, filterTag].join(' ')
      updates.push({ taskId: id, tag: updatedTags })
    }

    if (updates.length === 0) {
      logger.info('[useDragAndDrop] No updates needed - all tasks already have this tag')
      return
    }

    logger.info('[useDragAndDrop] Adding tag via filter drop', {
      filterTag,
      updateCount: updates.length
    })

    try {
      await onBulkUpdate(updates)
      try {
        clearSelection()
      } catch {
        /* Intentionally ignore errors */
      }
    } catch (error) {
      logger.error('[useDragAndDrop] Failed to add tag via filter drop', {
        error: error instanceof Error ? error.message : String(error)
      })
      alert((error as Error).message || 'Failed to add tag')
    }
  }

  return {
    dragOverTag,
    dragOverFilter,
    setDragOverFilter,
    selectedIds,
    isSelecting,
    marqueeRect,
    selectionJustEndedAt,
    // selection handlers
    selectionStartHandler,
    selectionMoveHandler,
    selectionEndHandler,
    clearSelection,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDragLeave,
    onDrop,
    onFilterDragOver,
    onFilterDragLeave,
    onFilterDrop
  }
}
