export function createActionFacade<T extends object>(
  actionsRef: { current: T | null },
  keys: readonly (keyof T)[],
): T {
  const facade: Partial<T> = {};
  for (const key of keys) {
    facade[key] = ((...args: unknown[]) => {
      const action = actionsRef.current?.[key];
      if (typeof action !== 'function') {
        throw new Error(`StoryAgent action "${String(key)}" is not ready`);
      }
      return (action as (...latestArgs: unknown[]) => unknown)(...args);
    }) as T[typeof key];
  }
  return facade as T;
}
