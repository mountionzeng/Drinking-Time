import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import EditingTransitionCandidateCard, {
  type EditingTransitionCandidate,
} from "./EditingTransitionCandidateCard";

vi.stubGlobal("React", React);

const baseCandidate: EditingTransitionCandidate = {
  sourceShotNo: "0104",
  targetShotNo: "0105",
  firstImageUrl: "https://example.com/first.webp",
  lastImageUrl: "https://example.com/last.webp",
  instruction: "女性快速转身，直接切到回望镜头，人物与场景不要变化。",
  prompt: "Preserve the same woman, dress, room and oil-painting texture.",
  durationSec: 2,
  resolution: "720p",
  estimatedCredits: 10,
  estimatedCny: 0.35,
  status: "pending",
};

function renderCandidate(
  patch: Partial<EditingTransitionCandidate> = {},
  busy = false
) {
  return renderToStaticMarkup(
    <EditingTransitionCandidateCard
      candidate={{ ...baseCandidate, ...patch }}
      busy={busy}
      onConfirm={vi.fn()}
      onModify={vi.fn()}
      onReject={vi.fn()}
    />
  );
}

describe("EditingTransitionCandidateCard", () => {
  it("shows the locked shot pair, generation spec, cost and paid confirmation boundary", () => {
    const html = renderCandidate();

    expect(html).toContain("0104 → 0105");
    expect(html).toContain("女性快速转身");
    expect(html).toContain("2 秒");
    expect(html).toContain("720P");
    expect(html).toContain("Vidu Q2");
    expect(html).not.toContain("credits");
    expect(html).toContain("¥0.35");
    expect(html).toContain("确认后才会提交 302");
    expect(html).toContain("确认并生成");
    expect(html).toContain("修改");
    expect(html).toContain("取消");
  });

  it("locks controls and explains automatic insertion while generation is running", () => {
    const html = renderCandidate({ status: "generating" });

    expect(html).toContain("302 已提交");
    expect(html).toContain("完成后会自动创建可继续剪辑的普通镜头");
    expect(html).toContain("正在生成并插入…");
    expect(html).toContain("disabled");
    expect(html).not.toContain("确认并生成");
  });

  it("renders applied, rejected and retryable failure outcomes", () => {
    expect(renderCandidate({ status: "applied" })).toContain(
      "视频已生成，并作为普通镜头插入对应位置"
    );
    expect(renderCandidate({ status: "rejected" })).toContain(
      "已取消，不会提交 302"
    );

    const failed = renderCandidate({
      status: "failed",
      error: "302 暂时不可用",
    });
    expect(failed).toContain("302 暂时不可用");
    expect(failed).toContain("重试生成");
    expect(failed).toContain("修改");
  });

  it("shows an in-flight label before a pending confirmation request resolves", () => {
    const html = renderCandidate({}, true);

    expect(html).toContain("正在提交…");
    expect(html).toContain("disabled");
  });
});
