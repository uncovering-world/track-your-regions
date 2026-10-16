/**
 * How long each step of a build took, read off the phase messages it reports
 * (#1527): a message names its step before a colon or a trailing ellipsis
 * ("Pass 2 of 2: writing 24,300,000 items...", "Indexing..."), and a step
 * runs until the next one starts. What the row of a build that ended says,
 * so a trial on a sample shows which step a change made slower.
 */

/** The step a phase message names. */
export function stepName(message: string): string {
  const colon = message.indexOf(':');
  const head = colon === -1 ? message : message.slice(0, colon);
  return (head.endsWith('...') ? head.slice(0, -3) : head).trim();
}

/** A duration as a row says it: `40 s`, `3 min 5 s`, `2 h 4 min`. */
export function spoken(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${seconds % 60} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export class StepTimes {
  private readonly done: { name: string; ms: number }[] = [];
  private current: { name: string; at: number } | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  /** A phase message: a new step unless it names the one running. Answers whether a step started. */
  phase(message: string): boolean {
    const name = stepName(message);
    if (this.current?.name === name) return false;
    this.end();
    this.current = { name, at: this.now() };
    return true;
  }

  /**
   * The steps so far, the one running closed now; empty when no step was named. A step that
   * took under a second is left out: it is a step the next one replaced at once, such as the
   * worker's own first message before the keeper names its first pass.
   */
  summary(): string {
    this.end();
    return this.done.filter(step => step.ms >= 1000).map(step => `${step.name} ${spoken(step.ms)}`).join(', ');
  }

  private end(): void {
    if (this.current) this.done.push({ name: this.current.name, ms: this.now() - this.current.at });
    this.current = null;
  }
}
