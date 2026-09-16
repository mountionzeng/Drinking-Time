import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SoundPlanTable } from "./SoundPlanTable";

vi.stubGlobal("React", React);

describe("SoundPlanTable", () => {
  it("marks AI drafts and keeps provider actions disabled", () => {
    const html = renderToStaticMarkup(
      <SoundPlanTable
        director={
          {
            active: true,
            pending: false,
            versions: [],
            session: {
              complete: true,
              question: null,
              interview: null,
              workspace: {
                revision: 3,
                selectionByRowId: { "row-1": true },
                rows: [
                  {
                    id: "row-1",
                    kind: "dialogue",
                    sceneId: "01",
                    startFrame: 0,
                    durationFrames: 90,
                    text: "她向母亲道歉",
                    textOrigin: "ai_draft",
                    evidence: [
                      { id: "shot:1", sourceKind: "shot", sourceId: "1" },
                    ],
                    performance: {},
                    eligibility: "ai_draft_unconfirmed",
                  },
                ],
              },
            },
            editRow: vi.fn(),
            setRowSelected: vi.fn(),
            confirmDraftText: vi.fn(),
            saveVersion: vi.fn(),
            restoreVersion: vi.fn(),
            exit: vi.fn(),
          } as never
        }
      />
    );
    expect(html).toContain("AI 草稿 · 待确认");
    expect(html).toContain("确认这句 AI 草稿");
    expect(html).toContain("音色稍后接入");
    expect(html).toContain("报价与生成未开启");
    expect(html).toContain("不会在这里产生费用");
  });
});
