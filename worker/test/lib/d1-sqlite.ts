/**
 * A faithful D1 adapter over Node's built-in `node:sqlite` (real SQLite), for
 * runtime verification harnesses. The stub D1 in phase0-verify.ts resolves every
 * query empty — fine for the KV/stats path, useless for proving optimistic
 * concurrency, CAS, or the KV→D1 cutover, all of which need real rows and a real
 * conditional UPDATE.
 *
 * It mimics exactly the slice of the D1 API that createD1Storage() uses:
 *   db.prepare(sql).bind(...args).run() / .all() / .first(col?)
 *   db.batch([stmt, ...])   — one transaction, all-or-nothing
 *   db.exec(sql)            — DDL / migrations
 *
 * Binding is positional `?` only (what T1's storage uses). Numbered `?N`
 * params (the T7 claim upsert) are a later extension.
 *
 * The DB is loaded from the SAME migration SQL that ships to prod
 * (hadoku_site/workers/task-api/migrations/…), so a harness proves the real
 * schema rather than a hand-copied approximation.
 */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

interface D1RunResult {
  success: true
  meta: { changes: number; last_row_id: number; rows_read: number; rows_written: number }
}
interface D1AllResult<T = Record<string, unknown>> {
  results: T[]
  success: true
  meta: { changes: number; last_row_id: number; rows_read: number; rows_written: number }
}

/** One `.bind()`-ed statement: holds SQL + params, executes on demand. */
class BoundStatement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly params: unknown[]
  ) {}

  private prepared() {
    return this.db.prepare(this.sql)
  }

  run(): D1RunResult {
    const info = this.prepared().run(...(this.params as never[]))
    return {
      success: true,
      meta: {
        changes: Number(info.changes),
        last_row_id: Number(info.lastInsertRowid),
        rows_read: 0,
        rows_written: Number(info.changes)
      }
    }
  }

  all<T = Record<string, unknown>>(): D1AllResult<T> {
    const rows = this.prepared().all(...(this.params as never[])) as T[]
    return {
      results: rows,
      success: true,
      meta: { changes: 0, last_row_id: 0, rows_read: rows.length, rows_written: 0 }
    }
  }

  first<T = Record<string, unknown>>(col?: string): T | null {
    const row = this.prepared().get(...(this.params as never[])) as
      | Record<string, unknown>
      | undefined
    if (row === undefined) return null
    if (col !== undefined) return (row[col] ?? null) as T
    return row as T
  }
}

/** A prepared (not yet bound) statement. D1 requires `.bind()` before execute. */
class PreparedStatement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string
  ) {}

  bind(...params: unknown[]): BoundStatement {
    return new BoundStatement(this.db, this.sql, params)
  }

  // D1 allows execute without bind for param-less statements.
  run(): D1RunResult {
    return new BoundStatement(this.db, this.sql, []).run()
  }
  all<T = Record<string, unknown>>(): D1AllResult<T> {
    return new BoundStatement(this.db, this.sql, []).all<T>()
  }
  first<T = Record<string, unknown>>(col?: string): T | null {
    return new BoundStatement(this.db, this.sql, []).first<T>(col)
  }
}

export interface FakeD1 {
  prepare(sql: string): PreparedStatement
  batch(statements: BoundStatement[]): Promise<Array<D1RunResult | D1AllResult>>
  exec(sql: string): Promise<{ count: number; duration: number }>
  /** test-only escape hatch */
  __raw: DatabaseSync
}

/**
 * Build an in-memory D1 shim. If `migrationSqlPath` is given, its SQL is applied
 * to create the schema; otherwise the DB starts empty (caller runs its own DDL).
 */
/**
 * Boot an in-memory DB from the real migrations. Accepts either a single .sql
 * file or the migrations DIRECTORY — pass the directory (what the harnesses do)
 * and every migration is applied in filename order, so a new one is picked up
 * everywhere without editing each harness.
 */
export function makeSqliteD1(migrationSqlPath?: string): FakeD1 {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON;')
  if (migrationSqlPath) {
    const files = statSync(migrationSqlPath).isDirectory()
      ? readdirSync(migrationSqlPath)
          .filter(f => f.endsWith('.sql'))
          .sort()
          .map(f => join(migrationSqlPath, f))
      : [migrationSqlPath]
    for (const file of files) db.exec(readFileSync(file, 'utf8'))
  }

  return {
    prepare(sql: string) {
      return new PreparedStatement(db, sql)
    },
    async batch(statements: BoundStatement[]) {
      db.exec('BEGIN IMMEDIATE;')
      try {
        // D1 batch runs each statement and returns each result. We can't know
        // ahead whether a statement reads or writes, so execute as .run() unless
        // it's a bare SELECT — mirroring how storage code consumes batch results
        // (it only ever reads .meta.changes off writes).
        const results = statements.map(s => s.run())
        db.exec('COMMIT;')
        return results
      } catch (e) {
        db.exec('ROLLBACK;')
        throw e
      }
    },
    async exec(sql: string) {
      db.exec(sql)
      return { count: 0, duration: 0 }
    },
    __raw: db
  }
}
