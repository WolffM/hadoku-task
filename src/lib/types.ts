export type ULID = string;

export type Task = {
  id: ULID;
  title: string;
  tag?: string | null;
  state: 'Active' | 'Deleted' | 'Completed';
  createdAt: string;         // ISO 8601
  updatedAt?: string | null; // ISO 8601
  closedAt?: string | null;
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
  state: 'Active' | 'Deleted' | 'Completed';
  createdAt: string;
  updatedAt?: string | null;
  closedAt?: string | null;
}

export type StatsFile = {
  version: 2;
  updatedAt: string;
  counters: {
    created: number;
    completed: number;
    edited: number;
    deleted: number;
  };
  timeline: Array<{
    t: string;
    event: 'created'|'completed'|'edited'|'deleted';
    id?: ULID;
  }>;
  // Persistent snapshot of every task ever seen (by id)
  tasks: Record<ULID, StatsTaskRecord>;
}
