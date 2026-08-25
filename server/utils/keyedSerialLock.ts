export type KeyedSerialLock<Key> = {
  run<T>(key: Key, task: () => Promise<T>): Promise<T>;
  clear(): void;
};

export function createKeyedSerialLock<Key>(): KeyedSerialLock<Key> {
  const tails = new Map<Key, Promise<void>>();

  return {
    clear(): void {
      tails.clear();
    },
    async run<T>(key: Key, task: () => Promise<T>): Promise<T> {
      const previous = tails.get(key) ?? Promise.resolve();
      let release!: () => void;
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      const tail = previous.catch(() => undefined).then(() => gate);
      tails.set(key, tail);

      await previous.catch(() => undefined);
      try {
        return await task();
      } finally {
        release();
        if (tails.get(key) === tail) tails.delete(key);
      }
    },
  };
}
