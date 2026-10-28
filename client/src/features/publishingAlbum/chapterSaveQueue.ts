/** One writer per opened chapter; edits arriving during a save wait for its version. */
export class ChapterSaveQueue<T> {
  private pending: T | undefined;
  private running: Promise<void> | null = null;
  private stopped: Error | null = null;
  private last: string;
  constructor(
    public version: number,
    initial: T,
    private write: (value: T, version: number) => Promise<number>
  ) {
    this.last = JSON.stringify(initial);
  }
  get dirty() {
    return this.pending !== undefined || this.running !== null;
  }
  enqueue(value: T) {
    if (JSON.stringify(value) !== this.last || this.running)
      this.pending = value;
  }
  flush(): Promise<void> {
    if (this.stopped) return Promise.reject(this.stopped);
    if (this.running) return this.running;
    this.running = this.drain().finally(() => {
      this.running = null;
    });
    return this.running;
  }
  private async drain() {
    while (this.pending !== undefined) {
      const value = this.pending;
      this.pending = undefined;
      const signature = JSON.stringify(value);
      if (signature === this.last) continue;
      try {
        this.version = await this.write(value, this.version);
        this.last = signature;
      } catch (error) {
        this.pending ??= value;
        this.stopped = error instanceof Error ? error : new Error("保存失败");
        throw this.stopped;
      }
    }
  }
}
