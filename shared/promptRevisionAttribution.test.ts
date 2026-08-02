import { describe, expect, it } from "vitest";

import {
  UTTERANCE_ELIGIBLE_DIMENSIONS,
  buildPromptAttribution,
  decodeAttributionReason,
  describeAttribution,
  encodeAttributionReason,
  mergeAttributionEvidence,
} from "./promptRevisionAttribution";
import { isKnownDimension } from "./promptDimensions";

describe("buildPromptAttribution", () => {
  it("把维度归一到规范 id", () => {
    const attribution = buildPromptAttribution({
      dimension: "styleRef",
      kind: "selection",
      sourceType: "storyboard-image",
      sourceId: "3:promptDraft",
    });
    expect(attribution.dimension).toBe("style_reference");
  });

  it("摘录超过 200 字截断并加省略号", () => {
    const long = "字".repeat(250);
    const attribution = buildPromptAttribution({
      dimension: "mood",
      kind: "utterance",
      excerpt: long,
    });
    const excerpt = attribution.evidence[0]?.excerpt ?? "";
    expect(excerpt.length).toBe(201);
    expect(excerpt.endsWith("…")).toBe(true);
  });

  it("空白摘录被丢弃而不是存成空字符串", () => {
    const attribution = buildPromptAttribution({
      dimension: "mood",
      kind: "manual",
      excerpt: "   ",
    });
    expect(attribution.evidence[0]?.excerpt).toBeUndefined();
  });

  it("未传 at 时使用当前时间的 ISO 字符串", () => {
    const attribution = buildPromptAttribution({
      dimension: "mood",
      kind: "manual",
    });
    expect(() => new Date(attribution.evidence[0]!.at).toISOString()).not.toThrow();
  });
});

describe("encodeAttributionReason / decodeAttributionReason 往返", () => {
  it("编码后能解出等价结构", () => {
    const attribution = buildPromptAttribution({
      dimension: "cameraMove",
      kind: "selection",
      sourceType: "storyboard-image",
      sourceId: "5:promptDraft",
      excerpt: "把镜头往左边挪一点",
    });
    const encoded = encodeAttributionReason(attribution);
    expect(decodeAttributionReason(encoded)).toEqual(attribution);
  });

  it("编码结果带版本前缀，不是裸 JSON", () => {
    const attribution = buildPromptAttribution({ dimension: "mood", kind: "manual" });
    expect(encodeAttributionReason(attribution)).toMatch(/^prompt-attribution\/v1:/);
  });
});

describe("decodeAttributionReason 对历史自由文本的容错", () => {
  const legacyReasons = [
    null,
    undefined,
    "",
    "legacy import",
    "initial story",
    "restore revision 5",
    "xiaozhuo-selection:storyboard-image:3:promptDraft",
    "creation-editor:styleRef",
  ];

  for (const reason of legacyReasons) {
    it(`"${reason}" 解析为 null，不抛错`, () => {
      expect(decodeAttributionReason(reason)).toBeNull();
    });
  }

  it("带前缀但 JSON 损坏时返回 null，不抛错", () => {
    expect(decodeAttributionReason("prompt-attribution/v1:{not json")).toBeNull();
  });

  it("带前缀且是合法 JSON，但形状不对（dimension 非字符串）时返回 null", () => {
    expect(
      decodeAttributionReason(`prompt-attribution/v1:${JSON.stringify({ dimension: 123, evidence: [] })}`),
    ).toBeNull();
  });

  it("带前缀且是合法 JSON，但 evidence 不是数组时返回 null", () => {
    expect(
      decodeAttributionReason(
        `prompt-attribution/v1:${JSON.stringify({ dimension: "mood", evidence: "nope" })}`,
      ),
    ).toBeNull();
  });

  it("evidence 数组里某一项缺 kind/at 时整体判为无效", () => {
    expect(
      decodeAttributionReason(
        `prompt-attribution/v1:${JSON.stringify({
          dimension: "mood",
          evidence: [{ kind: "manual", at: "2026-01-01T00:00:00.000Z" }, { note: "缺字段" }],
        })}`,
      ),
    ).toBeNull();
  });
});

describe("describeAttribution", () => {
  it("按证据类型分组计数", () => {
    const attribution = buildPromptAttribution({ dimension: "mood", kind: "utterance" });
    attribution.evidence.push({ kind: "utterance", at: new Date().toISOString() });
    attribution.evidence.push({ kind: "selection", at: new Date().toISOString() });
    expect(describeAttribution(attribution)).toBe("2 条聊天证据 + 1 条划词编辑证据");
  });

  it("空证据数组时给出兜底文案而不是空字符串", () => {
    expect(describeAttribution({ dimension: "mood", evidence: [] })).toBe("无证据记录");
  });
});

describe("UTTERANCE_ELIGIBLE_DIMENSIONS", () => {
  it("全部是词表里已知的规范维度", () => {
    for (const dimension of UTTERANCE_ELIGIBLE_DIMENSIONS) {
      expect(isKnownDimension(dimension)).toBe(true);
    }
  });

  it("不包含运镜/负面提示/美术配方这类不该被聊天随口改的维度", () => {
    const excluded = ["camera_motion", "negative_prompt", "art_style_recipe", "shot_type"];
    for (const dimension of excluded) {
      expect(UTTERANCE_ELIGIBLE_DIMENSIONS).not.toContain(dimension);
    }
  });
});

describe("mergeAttributionEvidence", () => {
  it("previous 为 null 时直接返回 next", () => {
    const next = buildPromptAttribution({ dimension: "mood", kind: "utterance" });
    expect(mergeAttributionEvidence(null, next)).toEqual(next);
  });

  it("维度相同时拼接证据，保留旧证据在前", () => {
    const previous = buildPromptAttribution({
      dimension: "mood",
      kind: "utterance",
      messageId: "msg-1",
    });
    const next = buildPromptAttribution({
      dimension: "mood",
      kind: "utterance",
      messageId: "msg-2",
    });
    const merged = mergeAttributionEvidence(previous, next);
    expect(merged.dimension).toBe("mood");
    expect(merged.evidence.map(e => e.messageId)).toEqual(["msg-1", "msg-2"]);
  });

  it("维度不同时不强行合并，直接返回 next", () => {
    const previous = buildPromptAttribution({ dimension: "mood", kind: "utterance" });
    const next = buildPromptAttribution({ dimension: "subject", kind: "utterance" });
    expect(mergeAttributionEvidence(previous, next)).toEqual(next);
  });

  it("证据数超过上限时只保留最近的条目", () => {
    let attribution = buildPromptAttribution({
      dimension: "mood",
      kind: "utterance",
      messageId: "msg-0",
    });
    for (let i = 1; i <= 10; i += 1) {
      attribution = mergeAttributionEvidence(
        attribution,
        buildPromptAttribution({ dimension: "mood", kind: "utterance", messageId: `msg-${i}` }),
      );
    }
    expect(attribution.evidence.length).toBe(8);
    expect(attribution.evidence.map(e => e.messageId)).toEqual([
      "msg-3", "msg-4", "msg-5", "msg-6", "msg-7", "msg-8", "msg-9", "msg-10",
    ]);
  });
});
