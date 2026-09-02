import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  canonicalizeEditMask,
} from "./imageEditMask";

async function rgba(bytes: Buffer): Promise<number[]> {
  return [
    ...(await sharp(bytes).ensureAlpha().raw().toBuffer()),
  ];
}

describe("canonicalizeEditMask", () => {
  it("makes the clicked white object editable and protects all other pixels", async () => {
    const provider = await sharp(
      Buffer.from([
        0, 0, 0, 255,
        255, 255, 255, 255,
      ]),
      { raw: { width: 2, height: 1, channels: 4 } }
    ).png().toBuffer();

    const result = await canonicalizeEditMask({
      maskBytes: provider,
      sourceWidth: 2,
      sourceHeight: 1,
      clickX: 1,
      clickY: 0,
    });

    expect(await rgba(result.editMask)).toEqual([
      0, 0, 0, 255,
      0, 0, 0, 0,
    ]);
    expect(result.editablePixelCount).toBe(1);
  });

  it("uses varying alpha when the provider mask encodes selection in transparency", async () => {
    const provider = await sharp(
      Buffer.from([
        255, 255, 255, 0,
        255, 255, 255, 255,
        255, 255, 255, 0,
      ]),
      { raw: { width: 3, height: 1, channels: 4 } }
    ).png().toBuffer();

    const result = await canonicalizeEditMask({
      maskBytes: provider,
      sourceWidth: 3,
      sourceHeight: 1,
      clickX: 1,
      clickY: 0,
    });

    expect((await rgba(result.editMask)).filter((_, index) => index % 4 === 3))
      .toEqual([255, 0, 255]);
  });

  it("rejects a mask that would expose the whole image", async () => {
    const provider = await sharp({
      create: { width: 4, height: 4, channels: 4, background: "white" },
    }).png().toBuffer();

    await expect(canonicalizeEditMask({
      maskBytes: provider,
      sourceWidth: 4,
      sourceHeight: 4,
      clickX: 1,
      clickY: 1,
    })).rejects.toThrow(/安全编辑/);
  });

  it("rejects source coordinates outside the image", async () => {
    const provider = await sharp({
      create: { width: 2, height: 2, channels: 4, background: "black" },
    }).png().toBuffer();

    await expect(canonicalizeEditMask({
      maskBytes: provider,
      sourceWidth: 2,
      sourceHeight: 2,
      clickX: 2,
      clickY: 0,
    })).rejects.toThrow(/点击位置/);
  });

  it("rejects oversized source dimensions before allocating raw RGBA buffers", async () => {
    const provider = await sharp({
      create: { width: 1, height: 1, channels: 4, background: "black" },
    }).png().toBuffer();

    await expect(canonicalizeEditMask({
      maskBytes: provider,
      sourceWidth: 12_000_001,
      sourceHeight: 1,
      clickX: 0,
      clickY: 0,
    })).rejects.toThrow(/源图尺寸/);
  });

  it("intersects a semantic object mask with the user's lasso", async () => {
    const provider = await sharp(
      Buffer.from([
        0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255,
        0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255,
      ]),
      { raw: { width: 4, height: 2, channels: 4 } }
    ).png().toBuffer();

    const result = await canonicalizeEditMask({
      maskBytes: provider,
      sourceWidth: 4,
      sourceHeight: 2,
      clickX: 1,
      clickY: 0,
      selectionPolygon: [
        { x: 0.5, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
        { x: 0.5, y: 2 },
      ],
    });

    expect((await rgba(result.editMask)).filter((_, index) => index % 4 === 3))
      .toEqual([
        255, 0, 255, 255,
        255, 0, 255, 255,
      ]);
    expect(result.editablePixelCount).toBe(2);
  });

  it("rejects a lasso that does not overlap the semantic object", async () => {
    const provider = await sharp(
      Buffer.from([
        0, 0, 0, 255,
        255, 255, 255, 255,
        0, 0, 0, 255,
      ]),
      { raw: { width: 3, height: 1, channels: 4 } }
    ).png().toBuffer();

    await expect(canonicalizeEditMask({
      maskBytes: provider,
      sourceWidth: 3,
      sourceHeight: 1,
      clickX: 1,
      clickY: 0,
      selectionPolygon: [
        { x: 2.1, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 1 },
        { x: 2.1, y: 1 },
      ],
    })).rejects.toThrow(/圈选/);
  });
});
