import type { WritingCompanionSnapshot } from "@/features/writingCompanion/writingCompanionText";

export type DesktopQueuedMessage = {
  id: string;
  text: string;
  createdAt: number;
  status: "queued" | "sending" | "failed";
  writingContext?: WritingCompanionSnapshot;
};
type QueueState = { items: DesktopQueuedMessage[]; paused: boolean };
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const DESKTOP_CHAT_QUEUE_PREFIX = "dt:desktop:chat-queue:";

/** One request at a time; only explicit user action resumes a restored/failed queue. */
export class DesktopChatQueue {
  private state: QueueState = { items: [], paused: false };
  private listeners = new Set<() => void>();
  private running = false;
  private suspended = false;
  constructor(
    private key: string,
    private storage: StorageLike | null
  ) {
    try {
      const items: unknown = JSON.parse(storage?.getItem(key) ?? "[]");
      if (Array.isArray(items)) {
        const restored = items.filter((item): item is DesktopQueuedMessage =>
          Boolean(
            item &&
              typeof item.id === "string" &&
              typeof item.text === "string" &&
              item.text.trim() &&
              typeof item.createdAt === "number" &&
              ["queued", "sending", "failed"].includes(item.status) &&
              (!item.writingContext ||
                (typeof item.writingContext.draft === "string" &&
                  typeof item.writingContext.cursor === "number" &&
                  typeof item.writingContext.scope === "string"))
          )
        );
        this.state = {
          items: restored.map(item => ({
            ...item,
            status: item.status === "sending" ? "failed" : item.status,
          })),
          paused: restored.length > 0,
        };
      }
    } catch {
      /* Unreadable recovery must never trigger a request. */
    }
  }
  snapshot = () => this.state;
  setSuspended(value: boolean) {
    this.suspended = value;
  }
  moveTo(key: string) {
    if (this.key === key) return;
    if (this.state.items.length)
      this.storage?.setItem(key, JSON.stringify(this.state.items));
    this.storage?.removeItem(this.key);
    this.key = key;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private update(next: QueueState) {
    // Fail before accepting input if durable recovery is unavailable.
    if (!this.suspended) {
      if (next.items.length)
        this.storage?.setItem(this.key, JSON.stringify(next.items));
      else this.storage?.removeItem(this.key);
    }
    this.state = next;
    this.listeners.forEach(listener => listener());
  }
  enqueue(text: string, writingContext?: WritingCompanionSnapshot) {
    const item: DesktopQueuedMessage = {
      id: `desktop-chat-${crypto.randomUUID()}`,
      text: text.trim(),
      createdAt: Date.now(),
      status: "queued",
      writingContext: writingContext
        ? {
            ...writingContext,
            selection: writingContext.selection
              ? { ...writingContext.selection }
              : undefined,
          }
        : undefined,
    };
    if (!item.text) return;
    this.update({ ...this.state, items: [...this.state.items, item] });
  }
  takeBack(id: string) {
    const item = this.state.items.find(item => item.id === id);
    if (!item || item.status === "sending") return null;
    const items = this.state.items.filter(item => item.id !== id);
    this.update({ items, paused: items.length > 0 });
    return item;
  }
  resume() {
    if (this.state.items.some(item => item.status === "failed")) return;
    this.update({ ...this.state, paused: false });
  }
  async drain(
    run: (item: DesktopQueuedMessage) => Promise<boolean>,
    isCurrent: () => boolean
  ) {
    if (this.running || this.suspended || this.state.paused || !isCurrent())
      return;
    this.running = true;
    try {
      while (
        this.state.items.length &&
        !this.suspended &&
        !this.state.paused &&
        isCurrent()
      ) {
        const item = this.state.items[0];
        if (item.status !== "queued") break;
        this.update({
          ...this.state,
          items: this.state.items.map(value =>
            value.id === item.id ? { ...value, status: "sending" } : value
          ),
        });
        let succeeded = false;
        try {
          succeeded = await run(item);
        } catch {
          /* Pause; never auto-replay an uncertain call. */
        }
        this.update({
          items: succeeded
            ? this.state.items.filter(value => value.id !== item.id)
            : this.state.items.map(value =>
                value.id === item.id ? { ...value, status: "failed" } : value
              ),
          paused: !succeeded || this.state.paused,
        });
      }
    } catch (error) {
      // A failed recovery write must not strand a disabled "sending" item.
      this.state = {
        items: this.state.items.map(item =>
          item.status === "sending" ? { ...item, status: "failed" } : item
        ),
        paused: true,
      };
      this.listeners.forEach(listener => listener());
      throw error;
    } finally {
      this.running = false;
    }
  }
}
