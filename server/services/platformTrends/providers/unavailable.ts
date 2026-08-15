import type { PublishingTrendPlatformId } from "../../../../shared/publishingPlatformContext";
import type { PlatformTrendProvider } from "../provider";

export function createUnavailablePlatformTrendProvider(
  platform: PublishingTrendPlatformId
): PlatformTrendProvider {
  return {
    manifest: {
      providerId: `unavailable-${platform}`,
      providerLabel: "未配置可信趋势来源",
      platforms: [platform],
      authorization: {
        status: "unavailable",
        reference: "no-authorized-provider",
      },
      sourceDocument: "",
      parserVersion: "unavailable-v1",
    },
    async fetch() {
      throw new Error("Unavailable trend provider must never be called");
    },
  };
}
