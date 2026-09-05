import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  MobileEmptyState,
  MobileWorkspaceFrame,
  resolveMobileDirtyStorySwitch,
  resolveMobileInitialStoryId,
} from "./MobileWorkspace";

describe("MobileWorkspace", () => {
  it("cold-opens the first server-ordered Story", () => {
    expect(
      resolveMobileInitialStoryId([
        { id: 42, shotCount: 3 },
        { id: 17, shotCount: 0 },
      ])
    ).toBe(42);
    expect(resolveMobileInitialStoryId([])).toBeNull();
  });

  // 范围护栏：手机端只做聊和改字。正文常驻、聊聊是底部那位小人，
  // 时间线／预览／素材／分镜这些重活一律留在电脑上。
  it("keeps the phone scope to the document and 聊聊", () => {
    const html = renderToStaticMarkup(
      <MobileWorkspaceFrame
        activeView="chat"
        onViewChange={vi.fn()}
        storyPicker={<div>Story 选择器</div>}
        documentView={<p>正文内容</p>}
        chatView={<p>对话内容</p>}
      />
    );

    // 正文常驻，不再是需要切换才看得到的一个页签
    expect(html).toContain("正文内容");
    expect(html).toContain("对话内容");
    expect(html).toContain("聊聊");
    expect(html).toContain("来聊会儿");
    expect(html).not.toMatch(/时间线|预览|素材|图片|分镜/);
  });

  it("still renders the document when there is no conversation to attach", () => {
    const html = renderToStaticMarkup(
      <MobileWorkspaceFrame
        activeView="document"
        onViewChange={vi.fn()}
        storyPicker={<div>Story 选择器</div>}
      >
        <p>加载中</p>
      </MobileWorkspaceFrame>
    );

    expect(html).toContain("加载中");
  });

  it("does not import desktop workspace providers or panels", () => {
    const source = readFileSync(
      new URL("./MobileWorkspace.tsx", import.meta.url),
      "utf8"
    );
    expect(source).not.toMatch(
      /StoryAgentProvider|CreationEditorProvider|PublishingDraftWorkspace|Timeline|MaterialWarehouse|Preview/
    );
  });

  it("requires an explicit outcome before leaving a dirty Story", async () => {
    const save = vi.fn(async () => ({ status: "saved" as const }));
    const discard = vi.fn();

    await expect(
      resolveMobileDirtyStorySwitch("cancel", { save, discard })
    ).resolves.toBe("stay");
    await expect(
      resolveMobileDirtyStorySwitch("save", { save, discard })
    ).resolves.toBe("switch");
    await expect(
      resolveMobileDirtyStorySwitch("discard", { save, discard })
    ).resolves.toBe("switch");
    expect(save).toHaveBeenCalledTimes(1);
    expect(discard).toHaveBeenCalledTimes(1);
  });

  it("keeps the current Story when saving remains failed or conflicted", async () => {
    for (const status of ["failed", "uncertain", "conflict"] as const) {
      await expect(
        resolveMobileDirtyStorySwitch("save", {
          save: vi.fn(async () => ({ status })),
          discard: vi.fn(),
        })
      ).resolves.toBe("stay");
    }
  });

  it("directs empty accounts to create their first Story on desktop", () => {
    const html = renderToStaticMarkup(<MobileEmptyState />);
    expect(html).toContain("请先在电脑上创建 Story");
  });
});
