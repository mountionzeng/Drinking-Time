/** Stop waiting for the optional pre-submit check without starting a paid render. */
export class StoryboardPreflightTimeout extends Error {
  constructor() {
    super('人物检查超时，请稍后重试；本次未提交视频生成。');
    this.name = 'StoryboardPreflightTimeout';
  }
}

export async function withStoryboardPreflightTimeout<T>(
  operation: Promise<T>,
  timeoutMs = 30_000
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new StoryboardPreflightTimeout()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
