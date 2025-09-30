export type ULID = string;

export type Task = {
  id: ULID;
  title: string;
  tag?: string | null;
  project?: string | null;
  createdAt: string;         // ISO 8601
  updatedAt?: string | null; // ISO 8601
  completedAt?: string | null;
  deleted?: boolean;
}

export type TasksFile = {
  version: 1;
  updatedAt: string;
  tasks: Task[];
}

// STATS v2 includes persistent records of all tasks (even deleted) + timeline
export type StatsTaskRecord = {
  id: ULID;
  title: string;
  tag?: string | null;
  project?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  completedAt?: string | null;
  deletedAt?: string | null;
  state: 'active' | 'completed' | 'deleted';
}

export type StatsFile = {
  version: 2;
  updatedAt: string;
  counters: {
    created: number;
    completed: number;
    edited: number;
    deleted: number;
    sessions: number;
  };
  timeline: Array<{
    t: string;
    event: 'create'|'complete'|'edit'|'delete'|'session';
    id?: ULID;
  }>;
  // Persistent snapshot of every task ever seen (by id)
  tasks: Record<ULID, StatsTaskRecord>;
}
