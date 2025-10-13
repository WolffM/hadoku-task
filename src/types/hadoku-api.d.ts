// Ambient declaration to satisfy imports of '@hadoku/task/api/types' used across the project
// Re-exports types from the local src/lib/types.ts
declare module '@hadoku/task/api/types' {
  export type ULID = import('../lib/types').ULID
  export type UserType = import('../lib/types').UserType
  export type Task = import('../lib/types').Task
  export type TasksFile = import('../lib/types').TasksFile
  export type Board = import('../lib/types').Board
  export type BoardsFile = import('../lib/types').BoardsFile
  export type StatsFile = import('../lib/types').StatsFile
  export type CreateTaskInput = import('../lib/types').CreateTaskInput
  export type UpdateTaskInput = import('../lib/types').UpdateTaskInput
  export { }
}
