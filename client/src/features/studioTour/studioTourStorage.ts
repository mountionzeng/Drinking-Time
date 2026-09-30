/**
 * 「这份引导看过了没有」只存本机，按账号分开。
 *
 * 形状照 DailyLetterWelcome 的 seen 机制来：纯函数判断 + try/catch 包住读写。
 * localStorage 被禁用时读不到也写不进，此时**不自动弹**——
 * 否则每次进工作室都要被拦一次，比没有引导更烦人。
 */
const STUDIO_TOUR_SEEN_PREFIX = "dt:studioTourSeen";

export const STUDIO_TOUR_REPLAY_EVENT = "dt:studio-tour-replay";

export function studioTourSeenKey(userId: number) {
  return `${STUDIO_TOUR_SEEN_PREFIX}:${userId}`;
}

/**
 * 自动播放只发生在「这个账号从没看过」且没有别的弹层占着屏幕的时候。
 * forced 是用户自己点「重看」，无条件放行。
 */
export function shouldShowStudioTour(params: {
  forced: boolean;
  seen: boolean;
  storageReadable: boolean;
  hasUser: boolean;
}): boolean {
  if (params.forced) return true;
  return Boolean(params.hasUser && params.storageReadable && !params.seen);
}

export type StudioTourSeenState = {
  seen: boolean;
  /** false 表示本机不让读 localStorage，此时不做自动播放。 */
  readable: boolean;
};

export function readStudioTourSeen(userId: number): StudioTourSeenState {
  try {
    return {
      seen: window.localStorage.getItem(studioTourSeenKey(userId)) !== null,
      readable: true,
    };
  } catch {
    return { seen: false, readable: false };
  }
}

export function writeStudioTourSeen(userId: number, at: string) {
  try {
    window.localStorage.setItem(studioTourSeenKey(userId), at);
  } catch {
    // 存不下只影响「下次还会不会自动弹」，不影响这一次能不能看完。
  }
}

export function clearStudioTourSeen(userId: number) {
  try {
    window.localStorage.removeItem(studioTourSeenKey(userId));
  } catch {
    // 同上：清不掉也不该让「重看」这个动作失败。
  }
}

/** 下一步的落点；已经是最后一步就返回 null，表示该收尾了。 */
export function nextStudioTourIndex(
  current: number,
  total: number
): number | null {
  return current + 1 < total ? current + 1 : null;
}

export function previousStudioTourIndex(current: number): number {
  return current > 0 ? current - 1 : 0;
}
