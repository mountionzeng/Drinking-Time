import { describe, expect, it } from "vitest";

import { PUBLISHING_ALBUM_FONTS } from "../shared/publishingAlbumFonts";
import { verifyPublishingAlbumFonts } from "./verify-publishing-album-fonts";

describe("verify publishing album fonts", () => {
  it("accepts the pinned OFL repository with verified glyph coverage", async () => {
    await expect(verifyPublishingAlbumFonts()).resolves.toEqual({
      fontCount: 5,
      totalBytes: 59_133_088,
    });
  });

  it("rejects checksum and mutable-source drift", async () => {
    const manifest = PUBLISHING_ALBUM_FONTS.map((font, index) => index === 0 ? {
      ...font,
      sha256: "0".repeat(64),
      sourceUrl: font.sourceUrl.replace(font.sourceCommit, "main"),
    } : font);
    await expect(verifyPublishingAlbumFonts({ manifest })).rejects.toThrow(/source URL is mutable|SHA-256 mismatch/);
  });
});
