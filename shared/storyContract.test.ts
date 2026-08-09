import { describe, expect, it } from "vitest";

import {
  assertPersistedStoryBodyEnvelope,
  parsePersistedStoryBody,
  persistedStoryIdSchema,
  stableShotIdSchema,
  storyShotFieldPatchSchema,
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
});
