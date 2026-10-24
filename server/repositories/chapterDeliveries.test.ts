import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as legacy from "../db";
import type { ChapterPackage } from "../../shared/chapterPackage";
import {
  claimChapterDelivery,
  completeChapterAssetUpload,
  findChapterDeliveryByRequest,
  setChapterAssetUploadTicket,
  startChapterDelivery,
} from "./chapterDeliveries";

const pkg = (packageId: string): ChapterPackage => ({
  kind: "chapter-package",
  version: 1,
  packageId,
  createdAt: "2026-10-23T00:00:00.000Z",
  sender: { platform: "web", displayName: "作者" },
  storyTitle: "夏天",
  lineage: { rootPackageId: packageId, parentPackageId: null },
  chapters: [],
  assets: [{ assetId: "asset_cover", sha256: "a".repeat(64), mime: "image/png", bytes: 4, width: 1, height: 1, aiGenerated: false }],
} as unknown as ChapterPackage);

function startInput(requestId: string, packageId = "cp_one") {
  const createdAt = new Date("2026-10-23T00:00:00.000Z");
  return {
    package: pkg(packageId),
    packageHash: "b".repeat(64),
    requestHash: "c".repeat(64),
    assets: [{ assetId: "asset_cover", sha256: "a".repeat(64), mime: "image/png", bytes: 4 }],
    packageExpiresAt: new Date("2026-11-22T00:00:00.000Z"),
    row: {
      deliveryId: `delivery-${requestId}`,
      packageId,
      senderUserId: 1,
      recipientUserId: null,
      claimTokenHash: "d".repeat(64),
      claimExpiresAt: new Date("2026-10-30T00:00:00.000Z"),
      kind: "send" as const,
      status: "pending" as const,
      requestId,
      requestHash: "c".repeat(64),
      readyAt: null,
      createdAt,
      updatedAt: createdAt,
      expiresAt: new Date("2026-11-22T00:00:00.000Z"),
    },
  };
}

describe("chapter delivery repository", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "");
    legacy.resetMemoryStateForTesting();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("makes repeated request ids idempotent and rejects changed payloads", async () => {
    const firstInput = startInput("req-one");
    const first = await startChapterDelivery(firstInput);
    const repeated = await startChapterDelivery(firstInput);
    expect(first.repeated).toBe(false);
    expect(repeated).toMatchObject({ repeated: true, delivery: { deliveryId: "delivery-req-one" } });
    await expect(startChapterDelivery({
      ...firstInput,
      requestHash: "e".repeat(64),
      row: { ...startInput("req-one").row, requestHash: "e".repeat(64) },
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await findChapterDeliveryByRequest(1, "req-one")).toMatchObject({ deliveryId: "delivery-req-one" });
  });

  it("does not let a recipient claim an image package until upload completes, then permits one claimant", async () => {
    const started = await startChapterDelivery(startInput("req-two"));
    expect(await claimChapterDelivery({ deliveryId: started.delivery.deliveryId, tokenHash: "d".repeat(64), userId: 2, now: new Date("2026-10-23T01:00:00Z") })).toBeNull();
    await expect(completeChapterAssetUpload({
      packageId: "cp_one", assetId: "asset_cover", tokenHash: "d".repeat(64), storageKey: "chapter-delivery/a.png",
      uploadedAt: new Date("2026-10-23T01:00:00Z"),
    })).resolves.toBe("invalid");
    await setChapterAssetUploadTicket({ packageId: "cp_one", assetId: "asset_cover", tokenHash: "f".repeat(64), expiresAt: new Date("2026-10-24T00:00:00Z") });
    await expect(completeChapterAssetUpload({
      packageId: "cp_one", assetId: "asset_cover", tokenHash: "f".repeat(64), storageKey: "chapter-delivery/a.png",
      uploadedAt: new Date("2026-10-23T01:00:00Z"),
    })).resolves.toBe("uploaded");
    const claimed = await claimChapterDelivery({ deliveryId: started.delivery.deliveryId, tokenHash: "d".repeat(64), userId: 2, now: new Date("2026-10-23T02:00:00Z") });
    expect(claimed?.recipientUserId).toBe(2);
    expect(await claimChapterDelivery({ deliveryId: started.delivery.deliveryId, tokenHash: "d".repeat(64), userId: 3, now: new Date("2026-10-23T02:00:00Z") })).toBeNull();
  });
});
