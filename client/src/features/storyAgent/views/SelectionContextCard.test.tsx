import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import SelectionContextCard from "./SelectionContextCard";

describe("SelectionContextCard", () => {
  it("labels the exact timeline frame selected for chat", () => {
    const html = renderToStaticMarkup(
      <SelectionContextCard
        selection={{
          sourceType: "storyboard-image",
          sourceId: "timeline-frame:frame-88",
          selectedText: "0101 · 当前帧 00:01.433 · 当前抽帧",
          objectVersion: "timeline-clip:frame-88",
          stableShotId: "shot-0101",
          shotNo: 1,
          cueCode: "0101",
        }}
      />
    );

    expect(html).toContain("当前抽帧");
    expect(html).toContain("timeline-clip:frame-88");
    expect(html).not.toContain("故事版主图");
  });

  it("states the exact scope promise for text, image, and confirmed regions", () => {
    const text = renderToStaticMarkup(
      <SelectionContextCard
        selection={{
          sourceType: "card",
          sourceId: "card-1",
          selectedText: "这一句话",
          selection: { kind: "text", start: 0, end: 5 },
        }}
      />
    );
    expect(text).toContain("只会替换这段文字");

    const image = renderToStaticMarkup(
      <SelectionContextCard
        selection={{
          sourceType: "storyboard-image",
          sourceId: "41",
          selectedText: "第二张图",
        }}
      />
    );
    expect(image).toContain("只会修改这张图片");

    const region = renderToStaticMarkup(
      <SelectionContextCard
        selection={{
          sourceType: "storyboard-image",
          sourceId: "41",
          selectedText: "帽子",
          selection: { kind: "rect", x: 0, y: 0, width: 0.2, height: 0.2 },
          confirmedImageRegion: {
            maskKey: "masks/1/7/41/hat-edit.png",
            imageId: 41,
            width: 100,
            height: 100,
            confirmed: true,
          },
        }}
      />
    );
    expect(region).toContain("区域外保持不变");
  });

  it("keeps historical chat text explicitly read-only", () => {
    const html = renderToStaticMarkup(
      <SelectionContextCard
        selection={{
          sourceType: "chat",
          sourceId: "msg-1",
          selectedText: "以前说过的话",
          selection: { kind: "text", start: 0, end: 7 },
        }}
      />
    );
    expect(html).toContain("不会改写历史消息");
  });

  it("shows stale readiness instead of ready-to-edit language", () => {
    const html = renderToStaticMarkup(
      <SelectionContextCard
        selection={{
          sourceType: "storyboard-image",
          sourceId: "41",
          selectedText: "旧图片",
          objectVersion: "image:41",
        }}
        readiness={{
          status: "stale",
          kind: "image",
          reason: "选区不属于当前故事",
        }}
      />
    );
    expect(html).toContain("已失效");
    expect(html).toContain("选区不属于当前故事");
    expect(html).not.toContain("只会修改这张图片");
  });
});
