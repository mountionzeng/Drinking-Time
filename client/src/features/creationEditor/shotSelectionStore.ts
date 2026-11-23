// Moving across a cut changes the selected shot, but none of the media,
// commands or chat history owned by the provider.
export function createShotSelection() {
  let current: number | null = null;
  const listeners = new Set<() => void>();
  return {
    read: () => current,
    select: (shotNo: number | null) => {
      if (current === shotNo) return;
      current = shotNo;
      for (const notify of listeners) notify();
    },
    subscribe: (notify: () => void) => {
      listeners.add(notify);
      return () => { listeners.delete(notify); };
    },
  };
}
