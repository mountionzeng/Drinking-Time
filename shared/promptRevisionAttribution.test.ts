import { describe, expect, it } from "vitest";

import {
  buildPromptAttribution,
  decodeAttributionReason,
  describeAttribution,
  encodeAttributionReason,
} from "./promptRevisionAttribution";

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
