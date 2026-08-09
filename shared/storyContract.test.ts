import { describe, expect, it } from "vitest";

import {
  applyStoryShotUpdate,
  assertPersistedStoryBodyEnvelope,
  parsePersistedStoryBody,
  persistedStoryIdSchema,
  stableShotIdSchema,
  storyShotFieldPatchSchema,
  storyShotUpdateCommandSchema,
} from "./storyContract";

describe("story contract", () => {
  it("保留扩展字段，同时验证故事版本和稳定镜头身份", () => {
    const body = parsePersistedStoryBody({
      _revision: 3,
      cards: [],
      messages: [],
      shots: [
        {
          stableShotId: "shot-0101",
          shotIdentity: "shot-0101",
          shotNo: 1,
          subject: "她站在窗边",
        },
      ],
      futureField: { enabled: true },
    });

    expect(body.futureField).toEqual({ enabled: true });
    expect(body.shots?.[0]).toMatchObject({
      stableShotId: "shot-0101",
      shotIdentity: "shot-0101",
      shotNo: 1,
      subject: "她站在窗边",
    });
  });

  it("拒绝非法持久化身份和版本", () => {
    expect(persistedStoryIdSchema.safeParse(-1).success).toBe(false);
    expect(stableShotIdSchema.safeParse("   ").success).toBe(false);
    expect(() =>
      parsePersistedStoryBody({
        _revision: -1,
        shots: [],
      })
    ).toThrow();
    expect(() =>
      assertPersistedStoryBodyEnvelope({ _revision: 1, cards: {} })
    ).toThrow("Story body cards 必须是数组");
  });

  it("镜头字段补丁只接受显式允许的字段", () => {
    expect(
      storyShotFieldPatchSchema.safeParse({ cameraMove: "缓慢推进" }).success
    ).toBe(true);
    expect(storyShotFieldPatchSchema.safeParse({}).success).toBe(false);
    expect(
      storyShotFieldPatchSchema.safeParse({ stableShotId: "覆盖身份" }).success
    ).toBe(false);
  });

  it("在同一镜头命令中合并字段、时长和提示词元数据", () => {
    const command = storyShotUpdateCommandSchema.parse({
      storyId: 7,
      stableShotId: " SHOT-0101 ",
      patch: { cameraMove: "缓慢推进" },
      metadata: {
        durationMs: 4200,
        promptOverride: {
          dimension: "genre",
          override: { value: "水彩", weight: 0.9 },
        },
        promptRun: {
          finalPrompt: "窗边人物，水彩质感",
          generatedAt: 123,
          imageId: 99,
          source: "prompt-table-rerender",
          usedDimensions: ["subject", "genre"],
        },
      },
    });

    expect(command.stableShotId).toBe("shot-0101");
    expect(
      applyStoryShotUpdate(
        {
          stableShotId: "shot-0101",
          cameraMove: "固定机位",
          promptOverrides: { tone: { value: "暖色", weight: 0.3 } },
        },
        command
      )
    ).toMatchObject({
      cameraMove: "缓慢推进",
      durationMs: 4200,
      promptOverrides: {
        tone: { value: "暖色", weight: 0.3 },
        genre: { value: "水彩", weight: 0.9 },
      },
      promptRun: { imageId: 99, finalPrompt: "窗边人物，水彩质感" },
    });
  });

  it("拒绝空镜头命令和越界编辑元数据", () => {
    expect(
      storyShotUpdateCommandSchema.safeParse({
        storyId: 7,
        stableShotId: "shot-0101",
      }).success
    ).toBe(false);
    expect(
      storyShotUpdateCommandSchema.safeParse({
        storyId: 7,
        stableShotId: "shot-0101",
        metadata: { durationMs: 99 },
      }).success
    ).toBe(false);
    expect(
      storyShotUpdateCommandSchema.safeParse({
        storyId: 7,
        stableShotId: "shot-0101",
        metadata: {
          promptOverride: { dimension: "genre", override: {} },
        },
      }).success
    ).toBe(false);
  });
});
