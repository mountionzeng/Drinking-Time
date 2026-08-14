import { describe, expect, it, vi } from "vitest";

import { inspectStaticImageCandidates } from "./staticImageQualityGate";

const pixel = "data:image/png;base64,iVBORw0KGgo=";

describe("inspectStaticImageCandidates", () => {
  it("keeps only candidates whose pixels contain no text, logo, signature, or watermark", async () => {
    const invoke = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        candidates: [
          {
            index: 1,
            verdict: "pass",
            risks: [],
            evidence: "",
            confidence: 0.99,
          },
          {
            index: 2,
            verdict: "fail",
            risks: ["readable_text", "watermark"],
            evidence: "右下角有账号水印",
            confidence: 0.98,
          },
          {
            index: 3,
            verdict: "fail",
            risks: ["pseudo_text"],
            evidence: "招牌上有伪文字",
            confidence: 0.96,
          },
          {
            index: 4,
            verdict: "pass",
            risks: [],
            evidence: "",
            confidence: 0.97,
          },
        ],
      }),
      modelLabel: "vision-test",
    });

    const result = await inspectStaticImageCandidates({
      candidates: [1, 2, 3, 4].map(index => ({
        imageUrl: `${pixel}#${index}`,
        imageKey: `generated/${index}.png`,
      })),
      invoke,
    });

    expect(result.accepted.map(candidate => candidate.originalIndex)).toEqual([
      1, 4,
    ]);
    expect(result.rejected).toEqual([
      expect.objectContaining({
        originalIndex: 2,
        risks: ["readable_text", "watermark"],
      }),
      expect.objectContaining({
        originalIndex: 3,
        risks: ["pseudo_text"],
      }),
    ]);
    expect(result.modelLabel).toBe("vision-test");
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ imageUrls: expect.any(Array) })
    );
  });

  it("fails closed when the model omits a candidate or is not confident", async () => {
    const invoke = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        candidates: [
          {
            index: 1,
            verdict: "pass",
            risks: [],
            evidence: "",
            confidence: 0.99,
          },
          {
            index: 2,
            verdict: "pass",
            risks: [],
            evidence: "",
            confidence: 0.4,
          },
        ],
      }),
      modelLabel: "vision-test",
    });

    const result = await inspectStaticImageCandidates({
      candidates: [1, 2, 3].map(index => ({
        imageUrl: `${pixel}#${index}`,
      })),
      invoke,
    });

    expect(result.accepted.map(candidate => candidate.originalIndex)).toEqual([
      1,
    ]);
    expect(result.rejected.map(candidate => candidate.risks)).toEqual([
      ["uncertain"],
      ["quality_check_incomplete"],
    ]);
  });

  it("accepts a clean pass at the calibrated 0.70 confidence boundary", async () => {
    const invoke = vi.fn().mockResolvedValue({
      text: JSON.stringify({
        candidates: [
          {
            index: 1,
            verdict: "pass",
            risks: [],
            evidence: "",
            confidence: 0.7,
          },
        ],
      }),
      modelLabel: "vision-test",
    });

    const result = await inspectStaticImageCandidates({
      candidates: [{ imageUrl: pixel }],
      invoke,
    });

    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
  });

  it("throws instead of allowing unchecked pixels through when vision output is invalid", async () => {
    const invoke = vi.fn().mockResolvedValue({
      text: "not json",
      modelLabel: "vision-test",
    });

    await expect(
      inspectStaticImageCandidates({
        candidates: [{ imageUrl: pixel }],
        invoke,
      })
    ).rejects.toThrow("静态图片质检结果不可解析");
  });
});
