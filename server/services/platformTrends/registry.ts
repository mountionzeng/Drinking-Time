import type { PublishingTrendPlatformId } from "../../../shared/publishingPlatformContext";
import type { PlatformTrendProvider } from "./provider";
import { createUnavailablePlatformTrendProvider } from "./providers/unavailable";

const providers: Record<PublishingTrendPlatformId, PlatformTrendProvider> = {
  xiaohongshu: createUnavailablePlatformTrendProvider("xiaohongshu"),
  douyin_tiktok: createUnavailablePlatformTrendProvider("douyin_tiktok"),
};

export function getPlatformTrendProvider(
  platform: PublishingTrendPlatformId
): PlatformTrendProvider {
  return providers[platform];
}
