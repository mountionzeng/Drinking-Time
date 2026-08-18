import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  emptyPublishingPlatformContextState,
  type PublishingPlatformContextSnapshot,
} from "@shared/publishingPlatformContext";
import {
  PublishingTrendTagPicker,
  publishingTrendSnapshotPresentation,
} from "./PublishingTrendTagPicker";

vi.stubGlobal("React", React);

function snapshot(
  status: PublishingPlatformContextSnapshot["status"] = "verified_fresh"
): PublishingPlatformContextSnapshot {
  return {
    snapshotId: "ctx-1",
    versionId: "v1",
    platform: "xiaohongshu",
    sourceRevision: 2,
    revision: 1,
    status,
    capability: status === "provider_error" ? "unavailable" : "verified",
    providerId: "official-fixture",
    providerLabel: "官方话题榜",
    authorization: {
      status: status === "provider_error" ? "unavailable" : "official",
      reference: "console-2026-08",
    },
    coverage: "公开话题榜",
    fetchedAt: 1_400,
    sourcePublishedAt: status === "provider_error" ? null : 1_300,
    expiresAt: status === "provider_error" ? 1_400 : 2_000,
    sourceDocument: "https://provider.example/docs",
    parserVersion: "fixture-v1",
    rawDigest: `sha256-${"a".repeat(64)}`,
    candidates: status === "verified_fresh"
      ? [{ id: "topic-ai", label: "AI&科技", sourcePublishedAt: 1_300 }]
      : [],
    contentSuggestions: ["独立开发"],
    message: status === "provider_error" ? "授权源暂时不可用" : "已获取",
    createdAt: 1_500,
  };
}

describe("PublishingTrendTagPicker", () => {
  it("does not call or imply realtime before the user explicitly opens it", () => {
    const html = renderToStaticMarkup(
      <PublishingTrendTagPicker
        platform="xiaohongshu"
        context={emptyPublishingPlatformContextState(1)}
        snapshot={null}
        busy={null}
        onRefresh={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(html).toContain("尚未查看平台热点");
    expect(html).toContain("不会自动调用");
    expect(html).toContain("查看热点");
    expect(html).not.toContain("可验证的实时热点");
  });

  it("separates verified provider candidates from ordinary content tags", () => {
    const current = snapshot();
    const context = {
      ...emptyPublishingPlatformContextState(1),
      snapshots: [current],
    };
    const html = renderToStaticMarkup(
      <PublishingTrendTagPicker
        platform="xiaohongshu"
        context={context}
        snapshot={current}
        busy={null}
        now={1_500}
        onRefresh={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(html).toContain("可验证的实时热点");
    expect(html).toContain("来源候选 · 默认不勾选");
    expect(html).toContain("AI&amp;科技");
    expect(html).toContain("普通内容标签 · 不冒充热门");
    expect(html).toContain("独立开发");
    expect(html).not.toContain('checked=""');
  });

  it("shows a fail-closed provider result without clearing saved tags", () => {
    const context = {
      ...emptyPublishingPlatformContextState(1),
      selectedTags: ["上次已选"],
    };
    const html = renderToStaticMarkup(
      <PublishingTrendTagPicker
        platform="xiaohongshu"
        context={context}
        snapshot={snapshot("provider_error")}
        busy={null}
        now={1_500}
        onRefresh={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(html).toContain("未获取到可验证的实时热点");
    expect(html).toContain("不会替换上次已选标签");
    expect(html).toContain("当前已保存：上次已选");
  });

  it("never labels an expired snapshot as realtime", () => {
    expect(publishingTrendSnapshotPresentation(
      { ...snapshot(), status: "verified_stale" },
      1_500
    ).label).toContain("已过实时有效期");
    expect(publishingTrendSnapshotPresentation(snapshot(), 2_001).tone).toBe("stale");
  });
});
