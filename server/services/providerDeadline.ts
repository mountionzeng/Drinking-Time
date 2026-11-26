/** A proxy may ignore AbortSignal. Bound response headers and consumption of the body. */
export async function withDeadline<T>(promise: Promise<T>, ms: number, phase: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(phase)), ms);
    })]);
  } finally {
    clearTimeout(timer);
  }
}
