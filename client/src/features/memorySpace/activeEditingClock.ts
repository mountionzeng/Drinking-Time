/** A conservative interaction clock: no reading, background, or idle time beyond 30 seconds. */
export class ActiveEditingClock {
  elapsedMs = 0;
  private sampledAt: number;
  private activeUntil = 0;
  constructor(now: number) {
    this.sampledAt = now;
  }
  sample(now: number, eligible: boolean) {
    if (eligible)
      this.elapsedMs += Math.max(
        0,
        Math.min(now, this.activeUntil) - this.sampledAt
      );
    else this.activeUntil = 0;
    this.sampledAt = now;
    return Math.floor(this.elapsedMs);
  }
  interact(now: number) {
    this.sample(now, true);
    this.activeUntil = now + 30_000;
  }
}
