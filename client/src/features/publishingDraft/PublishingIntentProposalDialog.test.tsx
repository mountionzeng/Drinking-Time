import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { defaultPublishingNarrativeIntent } from "@shared/publishingDraft";
import {
  PublishingIntentProposalDialog,
  publishingIntentDiff,
  publishingNarrativeIntentFromStoryIntent,
} from "./PublishingIntentProposalDialog";

vi.stubGlobal("React", React);
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <footer>{children}</footer>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <header>{children}</header>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

describe("PublishingIntentProposalDialog", () => {
  it("maps a self-to-public recognition into a visible version proposal", () => {
    const current = {
      ...defaultPublishingNarrativeIntent(1),
      primaryPurpose: "preserve" as const,
      coreAudience: "自己",
    };
    const proposed = publishingNarrativeIntentFromStoryIntent({
      purpose: "social_post",
      audience: "public",
      platform: "xiaohongshu",
      evidence: ["用户说想公开发给陌生人看"],
    }, current, 2);
    const html = renderToStaticMarkup(
      <PublishingIntentProposalDialog
        open
        current={current}
        proposed={proposed}
        evidence={["用户说想公开发给陌生人看"]}
        hasPublishingVersion
        busy={false}
        onOpenChange={vi.fn()}
        onAccept={vi.fn()}
        onReject={vi.fn()}
      />
    );

    expect(html).toContain("写作目的好像变了");
    expect(html).toContain("留存");
    expect(html).toContain("分享");
    expect(html).toContain("自己");
    expect(html).toContain("大众");
    expect(html).toContain("确认并创建新版本");
    expect(html).toContain("不采用这次建议");
  });

  it("shows only actual from/to differences", () => {
    const current = defaultPublishingNarrativeIntent(1);
    const changed = { ...current, coreAudience: "招聘者" };
    expect(publishingIntentDiff(current, changed).filter(line => line.changed)).toEqual([
      expect.objectContaining({ label: "最优先给谁看", to: "招聘者" }),
    ]);
  });
});
