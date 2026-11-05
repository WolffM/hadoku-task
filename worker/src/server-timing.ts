/**
 * Per-step durations for a `Server-Timing` header. The edge stores that header
 * on every request row (`request_logs.server_timing`), so a route that sets it
 * gets its latency split recorded with no other wiring.
 *
 * Steps may overlap (run under Promise.all); each reports its own wall time,
 * and `total` is the time since the timer was made.
 */
export class StepTimer {
  private readonly start = Date.now()
  private readonly steps: [string, number][] = []

  async step<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const t0 = Date.now()
    try {
      return await fn()
    } finally {
      this.steps.push([name, Date.now() - t0])
    }
  }

  header(): string {
    return [...this.steps, ['total', Date.now() - this.start] as [string, number]]
      .map(([name, dur]) => `${name};dur=${dur}`)
      .join(', ')
  }
}
