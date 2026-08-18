/**
 * Pure business logic handlers for task operations.
 * Framework-agnostic — usable with any web framework.
 *
 * The handlers live in sibling modules by domain (reads, tasks, boards, tags,
 * batch); this file re-exports them so `@wolffm/task/api` and every existing
 * import keep the same path and the same flat surface, which
 * src/test/handlers-verify.ts pins.
 */

export * from './handlers-reads.js'
export * from './handlers-tasks.js'
export * from './handlers-boards.js'
export * from './handlers-tags.js'
export * from './handlers-batch.js'
