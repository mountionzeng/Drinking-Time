import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  MobileEmptyState,
  MobileWorkspaceFrame,
  peekReplyCap,
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
        documentView={<p>正文内容</p>}
        chatView={() => <p>对话内容</p>}
      />
    );

    // 正文常驻，不再是需要切换才看得到的一个页签
    expect(html).toContain("正文内容");
    expect(html).toContain("对话内容");
    expect(html).toContain("聊聊");
    expect(html).not.toMatch(/时间线|预览|素材|图片|分镜/);
  });

  // 中间那颗只干一件事：打开故事菜单。聊天不需要它——常驻输入条一直在，
  // 要看历史就拖面板或点「拉开看全部」；换故事才是它不可替代的用途。
  it("always labels the middle seat 聊点其他的, in both views", () => {
    for (const view of ["document", "chat"] as const) {
      const html = renderToStaticMarkup(
        <MobileWorkspaceFrame
          activeView={view}
          onViewChange={vi.fn()}
            documentView={<p>正文内容</p>}
          chatView={() => <p>对话内容</p>}
        />
      );
      expect(html).toContain("聊点其他的");
      expect(html).not.toContain("来聊会儿");
    }
  });

  // 回归：原来对话框是当 children 传进来的，而内容区写的是
  // `documentView ?? children`——documentView 一有值 children 就整个不渲染。
  // 于是故事菜单、每日来信、「我」全都一次没出现过，表现为「大部分按钮
  // 按了没反应」。浮层必须和 documentView 并存。
  it("renders overlays alongside the document, not instead of it", () => {
    const html = renderToStaticMarkup(
      <MobileWorkspaceFrame
        activeView="document"
        onViewChange={vi.fn()}
        documentView={<p>正文内容</p>}
        overlays={<div>故事菜单在这里</div>}
      />
    );

    expect(html).toContain("正文内容");
    expect(html).toContain("故事菜单在这里");
  });

  // 回归：折叠档露出回信却不加高，输入框会被顶出屏幕——真机上就是
  // 「看得到回信，却没法打字」。露回信时面板必须留得更高。
  it("makes room for the peeked reply so the composer stays on screen", () => {
    const withoutReply = renderToStaticMarkup(
      <MobileWorkspaceFrame
        activeView="document"
        onViewChange={vi.fn()}
        documentView={<p>正文内容</p>}
        chatView={() => <p>对话内容</p>}
      />
    );
    const withReply = renderToStaticMarkup(
      <MobileWorkspaceFrame
        activeView="document"
        onViewChange={vi.fn()}
        documentView={<p>正文内容</p>}
        chatView={() => <p>对话内容</p>}
        hasPeekReply
      />
    );

    const heightOf = (html: string) =>
      Number(/height:([0-9.]+)px/.exec(html)?.[1] ?? 0);
    expect(heightOf(withReply)).toBeGreaterThan(heightOf(withoutReply));
  });

  // 收起档小杯子不能只是块装饰：它还在、还能点，点一下就拉开聊天。
  it("keeps the cup itself tappable while the sheet is collapsed", () => {
    const onViewChange = vi.fn();
    const html = renderToStaticMarkup(
      <MobileWorkspaceFrame
        activeView="document"
        onViewChange={onViewChange}
        documentView={<p>正文内容</p>}
        chatView={() => <p>对话内容</p>}
      />
    );

    expect(html).toMatch(
      /<button[^>]*data-sheet-action="character"[^>]*aria-label="拉开聊聊"/
    );
  });

  // 等回信时小杯子要摆出**思考**那套姿势和表情，不是原来那张脸动一动。
  // 姿势名会写进 EmotiveWuxingIcon 的 aria-label，正好当断言锚点。
  it("gives the cup a thinking face only while a reply is in flight", () => {
    const render = (waitingForReply: boolean) =>
      renderToStaticMarkup(
        <MobileWorkspaceFrame
          activeView="document"
          onViewChange={vi.fn()}
          documentView={<p>正文内容</p>}
          chatView={() => <p>对话内容</p>}
          waitingForReply={waitingForReply}
        />
      );

    expect(render(true)).toContain("聊聊 · 想着呢");
    // 回答到达／失败／中断后 waitingForReply 落回 false，思考就得退出
    expect(render(false)).not.toContain("聊聊 · 想着呢");
  });

  // 话语框可以长，但不能长到把正文挤没——收起档还得像「收起」。
  it("caps the speech box so the collapsed sheet still leaves the document visible", () => {
    expect(peekReplyCap(812)).toBe(260);
    expect(peekReplyCap(812)).toBeLessThan(812 * 0.4);
    // 小屏也要留得下一段话
    expect(peekReplyCap(0)).toBe(120);
  });

  // 顶栏不再放品牌名和故事名：微信顶栏已经写着来处，故事名在「聊点其他的」
  // 那张菜单里看得到，正文页最该留给正文本身。
  it("keeps the header free of the brand and story name", () => {
    const html = renderToStaticMarkup(
      <MobileWorkspaceFrame
        activeView="document"
        onViewChange={vi.fn()}
        documentView={<p>正文内容</p>}
      />
    );
    expect(html).toContain("正文内容");
    expect(html).not.toContain("碎碎念");
    expect(html).not.toContain("<select");
  });

  it("still renders the document when there is no conversation to attach", () => {
    const html = renderToStaticMarkup(
      <MobileWorkspaceFrame
        activeView="document"
        onViewChange={vi.fn()}
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

  it("lets an empty account create its first Story from the phone", () => {
    const html = renderToStaticMarkup(
      <MobileEmptyState onCreateStory={() => {}} />
    );
    expect(html).toContain("还没有故事");
    expect(html).toContain("新建一个故事");
    // 不再把人推去电脑：手机上就能建
    expect(html).not.toContain("请先在电脑上创建");
  });

  it("hides the create action when the caller cannot create", () => {
    const html = renderToStaticMarkup(<MobileEmptyState />);
    expect(html).not.toContain("新建一个故事");
  });

  it("surfaces a create failure instead of failing silently", () => {
    const html = renderToStaticMarkup(
      <MobileEmptyState error="新建失败，请重试" onCreateStory={() => {}} />
    );
    expect(html).toContain("新建失败，请重试");
  });
});
