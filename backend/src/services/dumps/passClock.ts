/**
 * How long the pass a build is reading has left (#1467): from the bytes it
 * has read of the file since the pass began and how fast, the rest at the
 * same pace. A new pass (the bytes read fall back) starts the clock again,
 * and the first minute of a pass gives no estimate, since a pace measured
 * over seconds says little about hours.
 */

/** How long a pass runs before its pace is trusted. */
const SETTLE_MS = 60_000;

export class PassClock {
  private start: { at: number; done: number } | null = null;
  private last = 0;

  /** Seconds left in the pass at `now`, or null while there is no telling. */
  observe(done: number, total: number | null, now: number): number | null {
    if (this.start === null || done < this.last) this.start = { at: now, done };
    this.last = done;
    const elapsed = now - this.start.at;
    const gained = done - this.start.done;
    if (total === null || elapsed < SETTLE_MS || gained <= 0) return null;
    return Math.max(0, Math.round(((total - done) / gained) * (elapsed / 1000)));
  }

  /** Forget the pass: the build moved to a step that reads no file. */
  reset(): void {
    this.start = null;
    this.last = 0;
  }
}
