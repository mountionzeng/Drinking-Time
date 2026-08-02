import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ShotCandidateBadge, { ShotCandidateList } from "./ShotCandidateBadge";
import type { ShotPendingCandidate } from "../shotCandidateSummary";

const candidate: ShotPendingCandidate = {
  revisionId: 301,
  nodeId: 30,
  dimension: "subject",
  label: "主体",
  currentContent: "少年",
  proposedContent: "少年在阳台上抽烟",
  attributionSummary: "2 条聊天证据",
};

describe("ShotCandidateBadge", () => {
  it("没有候选时不渲染任何东西", () => {
    const html = renderToStaticMarkup(
      <ShotCandidateBadge
        shotLabel="SH03"
        candidates={[]}
        onConfirm={vi.fn()}
        onReject={vi.fn()}
      />
    );
    expect(html).toBe("");
  });

  it("有候选时渲染徽章，显示正确的数量", () => {
    const html = renderToStaticMarkup(
      <ShotCandidateBadge
        shotLabel="SH03"
        candidates={[candidate, { ...candidate, revisionId: 302 }]}
        onConfirm={vi.fn()}
        onReject={vi.fn()}
      />
    );
    expect(html).toContain("2 待确认");
    expect(html).toContain("SH03 有 2 条待确认候选");
  });
});

describe("ShotCandidateList", () => {
  it("展示维度标签、当前内容（删除线）与提议内容", () => {
    const html = renderToStaticMarkup(
      <ShotCandidateList
        candidates={[candidate]}
        pendingRevisionId={null}
        onConfirm={vi.fn()}
        onReject={vi.fn()}
      />
    );
    expect(html).toContain("主体");
    expect(html).toContain("少年在阳台上抽烟");
    expect(html).toContain("line-through");
    expect(html).toContain("少年");
    expect(html).toContain("2 条聊天证据");
    expect(html).toContain("确认");
    expect(html).toContain("放弃");
  });

  it("currentContent 为 null 时显示（空）而不是空字符串或崩溃", () => {
    const html = renderToStaticMarkup(
      <ShotCandidateList
        candidates={[{ ...candidate, currentContent: null }]}
        pendingRevisionId={null}
        onConfirm={vi.fn()}
        onReject={vi.fn()}
      />
    );
    expect(html).toContain("（空）");
  });

  it("attributionSummary 为 null 时不渲染来源摘要", () => {
    const html = renderToStaticMarkup(
      <ShotCandidateList
        candidates={[{ ...candidate, attributionSummary: null }]}
        pendingRevisionId={null}
        onConfirm={vi.fn()}
        onReject={vi.fn()}
      />
    );
    expect(html).not.toContain("条聊天证据");
  });

  it("超长内容截断并加省略号", () => {
    const long = "字".repeat(200);
    const html = renderToStaticMarkup(
      <ShotCandidateList
        candidates={[{ ...candidate, proposedContent: long }]}
        pendingRevisionId={null}
        onConfirm={vi.fn()}
        onReject={vi.fn()}
      />
    );
    expect(html).toContain("…");
    expect(html).not.toContain(long);
  });

  it("正在处理的候选禁用按钮、显示加载态", () => {
    const html = renderToStaticMarkup(
      <ShotCandidateList
        candidates={[candidate]}
        pendingRevisionId={candidate.revisionId}
        onConfirm={vi.fn()}
        onReject={vi.fn()}
      />
    );
    expect(html).toContain("disabled");
    expect(html).toContain("animate-spin");
  });

  it("多条候选各自渲染", () => {
    const html = renderToStaticMarkup(
      <ShotCandidateList
        candidates={[
          candidate,
          { ...candidate, revisionId: 302, dimension: "mood", label: "情绪", proposedContent: "平静" },
        ]}
        pendingRevisionId={null}
        onConfirm={vi.fn()}
        onReject={vi.fn()}
      />
    );
    expect(html).toContain("主体");
    expect(html).toContain("情绪");
    expect(html).toContain("平静");
  });
});
