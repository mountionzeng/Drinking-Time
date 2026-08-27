import { describe, expect, it, vi } from "vitest";

import { inspectCanonicalBoardStructure } from "./visualAssetBoardStructure";

const BOARD = "data:image/png;base64,AAAA";

function invoker(text: string) {
  return vi.fn(async () => ({ text, modelLabel: "structure-test" }));
}

const CHARACTER_CHECK_IDS = [
  "subject_count",
  "full_body",
  "view_order",
  "face_readable",
  "same_person",
  "clean_board",
];

function allChecks(verdict: "pass" | "fail" | "unknown") {
  return CHARACTER_CHECK_IDS.map(id => ({ id, verdict }));
}

describe("canonical board structure inspection", () => {
  it("passes only when every check passes with evidence and high confidence", async () => {
    const invoke = invoker(
      JSON.stringify({
        checks: allChecks("pass"),
        confidence: 0.94,
        reason: "四栏依次为正面、侧面、背面全身与正面头部特写，同一人物",
      })
    );
    const result = await inspectCanonicalBoardStructure({
      kind: "character",
      boardImageUrl: BOARD,
      invoke: invoke as never,
    });
    expect(result.verdict).toBe("pass");
    expect(result.reason).toContain("四栏");
    expect(invoke.mock.calls[0]?.[0].imageUrls).toEqual([BOARD]);
    expect(invoke.mock.calls[0]?.[0].system).toContain("subject_count");
  });

  it("fails a single-portrait board and keeps the model's description", async () => {
    const invoke = invoker(
      JSON.stringify({
        checks: [
          { id: "subject_count", verdict: "fail" },
          { id: "full_body", verdict: "fail" },
          { id: "view_order", verdict: "fail" },
          { id: "face_readable", verdict: "fail" },
          { id: "same_person", verdict: "unknown" },
          { id: "clean_board", verdict: "pass" },
        ],
        confidence: 0.91,
        reason: "只有一个四分之三侧身人物，左右栏是空背景",
      })
    );
    const result = await inspectCanonicalBoardStructure({
      kind: "character",
      boardImageUrl: BOARD,
      invoke: invoke as never,
    });
    expect(result.verdict).toBe("fail");
    expect(result.reason).toBe("只有一个四分之三侧身人物，左右栏是空背景");
  });

  it("returns unknown when the vision call fails", async () => {
    const result = await inspectCanonicalBoardStructure({
      kind: "character",
      boardImageUrl: BOARD,
      invoke: (async () => {
        throw new Error("gateway timeout");
      }) as never,
    });
    expect(result.verdict).toBe("unknown");
    expect(result.reason).toContain("gateway timeout");
  });

  it("returns unknown when the response is not JSON", async () => {
    const result = await inspectCanonicalBoardStructure({
      kind: "character",
      boardImageUrl: BOARD,
      invoke: invoker("看起来没问题") as never,
    });
    expect(result.verdict).toBe("unknown");
  });

  it("returns unknown when a required check is missing from the response", async () => {
    const result = await inspectCanonicalBoardStructure({
      kind: "character",
      boardImageUrl: BOARD,
      invoke: invoker(
        JSON.stringify({
          checks: [
            { id: "subject_count", verdict: "pass" },
            { id: "full_body", verdict: "pass" },
          ],
          confidence: 0.99,
          reason: "看着不错",
        })
      ) as never,
    });
    expect(result.verdict).toBe("unknown");
    expect(result.reason).toContain("从左到右");
  });

  it("refuses to pass on low confidence or on a verdict with no stated evidence", async () => {
    const lowConfidence = await inspectCanonicalBoardStructure({
      kind: "character",
      boardImageUrl: BOARD,
      invoke: invoker(
        JSON.stringify({ checks: allChecks("pass"), confidence: 0.4, reason: "应该可以" })
      ) as never,
    });
    expect(lowConfidence.verdict).toBe("unknown");

    const noReason = await inspectCanonicalBoardStructure({
      kind: "character",
      boardImageUrl: BOARD,
      invoke: invoker(
        JSON.stringify({ checks: allChecks("pass"), confidence: 0.99 })
      ) as never,
    });
    expect(noReason.verdict).toBe("unknown");
  });

  it("treats an unrecognised verdict word as unknown instead of pass", async () => {
    const result = await inspectCanonicalBoardStructure({
      kind: "character",
      boardImageUrl: BOARD,
      invoke: invoker(
        JSON.stringify({
          checks: CHARACTER_CHECK_IDS.map(id => ({ id, verdict: "ok" })),
          confidence: 0.99,
          reason: "都对",
        })
      ) as never,
    });
    expect(result.verdict).toBe("unknown");
  });

  it("checks 2×2 layouts for scene and style assets", async () => {
    const invoke = invoker(
      JSON.stringify({ checks: [], confidence: 0.99, reason: "x" })
    );
    await inspectCanonicalBoardStructure({
      kind: "scene",
      boardImageUrl: BOARD,
      invoke: invoke as never,
    });
    expect(invoke.mock.calls[0]?.[0].system).toContain("2×2 四格");
    expect(invoke.mock.calls[0]?.[0].userText).toContain("establishing");
  });

  it("checks a pet as one animal across four identity views", async () => {
    const invoke = invoker(
      JSON.stringify({ checks: [], confidence: 0.99, reason: "x" })
    );
    await inspectCanonicalBoardStructure({
      kind: "pet",
      boardImageUrl: BOARD,
      invoke: invoke as never,
    });
    expect(invoke.mock.calls[0]?.[0].system).toContain("同一只宠物");
    expect(invoke.mock.calls[0]?.[0].system).toContain("没有人物、其他动物");
    expect(invoke.mock.calls[0]?.[0].userText).toContain("identity-detail");
  });
});
