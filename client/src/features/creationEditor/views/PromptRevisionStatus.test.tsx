import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { PromptRevision } from "@shared/promptLineage";
import type { PromptLineageRowView } from "../promptLineage/viewModel";
import PromptRevisionStatus from "./PromptRevisionStatus";

describe("PromptRevisionStatus", () => {
  it("shows the latest confirmed revision and a visible history action", () => {
    const row = {
      id: "intent",
      nodeId: 80,
      dimension: "intent",
      label: "镜头意图",
      weight: 0.85,
      revisionId: 109,
      authorType: "user",
    } as PromptLineageRowView;

    const html = renderToStaticMarkup(
      <PromptRevisionStatus
        row={row}
        storyVersion={5}
        historyOpen
        historyItems={
          [
            { id: 109, weight: 0.85, status: "confirmed" },
            { id: 108, weight: 0.75, status: "confirmed" },
          ] as PromptRevision[]
        }
        onOpenHistory={vi.fn()}
        onRestoreRevision={vi.fn()}
      />,
    );

    expect(html).toContain("rev #109");
    expect(html).toContain("权重 85%");
    expect(html).toContain("revision 历史");
    expect(html).toContain("故事提示词版本 v5");
    expect(html).toContain("rev #108");
    expect(html).toContain("75%");
    expect(html).toContain("恢复此版本");
  });
});
