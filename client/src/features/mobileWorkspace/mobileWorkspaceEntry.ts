export type RootWorkspacePath = "/m" | "/editing";

export type RootWorkspaceSignals = {
  userAgent?: string | null;
  userAgentDataMobile?: boolean | null;
  viewportWidth?: number | null;
  coarsePointer?: boolean | null;
};

const PHONE_USER_AGENT =
  /(?:\bMobi\b|Android.*Mobile|iPhone|iPod|Windows Phone|IEMobile|Opera Mini)/i;
const MAX_NARROW_PHONE_WIDTH = 767;

export function resolveRootWorkspacePath({
  userAgent,
  userAgentDataMobile,
  viewportWidth,
  coarsePointer,
}: RootWorkspaceSignals): RootWorkspacePath {
  if (typeof userAgentDataMobile === "boolean") {
    return userAgentDataMobile ? "/m" : "/editing";
  }

  const phoneUserAgent = PHONE_USER_AGENT.test(userAgent ?? "");
  const narrowTouchDevice =
    coarsePointer === true &&
    typeof viewportWidth === "number" &&
    Number.isFinite(viewportWidth) &&
    viewportWidth > 0 &&
    viewportWidth <= MAX_NARROW_PHONE_WIDTH;

  return phoneUserAgent || narrowTouchDevice ? "/m" : "/editing";
}

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    mobile?: boolean;
  };
};

export function rootWorkspacePath(): RootWorkspacePath {
  const browserNavigator =
    typeof navigator === "undefined"
      ? undefined
      : (navigator as NavigatorWithUserAgentData);
  const browserWindow = typeof window === "undefined" ? undefined : window;
  const coarsePointer = browserWindow?.matchMedia
    ? browserWindow.matchMedia("(pointer: coarse)").matches
    : (browserNavigator?.maxTouchPoints ?? 0) > 0;

  return resolveRootWorkspacePath({
    userAgent: browserNavigator?.userAgent,
    userAgentDataMobile: browserNavigator?.userAgentData?.mobile,
    viewportWidth: browserWindow?.innerWidth,
    coarsePointer,
  });
}
