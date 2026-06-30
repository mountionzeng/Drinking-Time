import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PromptRevision } from "@shared/promptLineage";
import type { PromptLineageRowView } from "../promptLineage/viewModel";
import PromptDatabaseView from "./PromptDatabaseView";

vi.stubGlobal("React", React);

function row(): PromptLineageRowView {
  return {
    id: "lineage:2",
    nodeId: 2,
    dimension: "subject",
    label: "主体",
    value: "她站在窗边，准备开口",
    weight: 0.42,
    category: "content",
    source: {
      system: "manual",
      label: "手改",
    },
    inheritance: "overridden",
    contentLength: 10,
    scope: "shot",
    modality: "shared",
    stableShotId: "shot-01",
    revisionId: 12,
    authorType: "user",
    createdAt: "2026-06-30T10:00:00.000Z",
    usedBy: ["dialogue", "image", "video"],
  };
}

function history(): PromptRevision[] {
  return [
    {
      id: 10,
      storyId: 9,
      userId: 7,
      nodeId: 2,
      parentRevisionId: null,
      content: "最初的人物站位",
      weight: 0.42,
      authorType: "migration",
      authorUserId: null,
      reason: null,
      source: null,
      status: "confirmed",
      createdAt: "2026-06-30T09:50:00.000Z",
      decidedAt: "2026-06-30T09:50:00.000Z",
    },
  ];
}

describe("Prompt lineage panel chrome", () => {
  it("renders the database view with edit and history affordances", () => {
    const html = renderToStaticMarkup(
      <PromptDatabaseView
        rows={[row()]}
        historyNodeId={2}
        historyItems={history()}
        onOpenHistory={() => {}}
        onPreviewChange={async () => {}}
        onRerender={async () => {}}
        onRestoreRevision={async () => {}}
      />,
    );

    expect(html).toContain("当前值");
    expect(html).toContain("镜头级");
    expect(html).toContain("共享");
    expect(html).toContain("预览影响");
    expect(html).toContain("查看历史");
    expect(html).toContain("rev #10");
    expect(html).toContain("最初的人物站位");
  });
});
