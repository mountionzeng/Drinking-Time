import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  defaultPublishingNarrativeIntent,
  emptyPublishingDraftState,
  resolvePublishingActiveVersion,
} from "@shared/publishingDraft";
import {
  PublishingVersionControls,
  publishingVersionLabel,
  publishingVersionNameError,
} from "./PublishingVersionControls";

vi.stubGlobal("React", React);

describe("PublishingVersionControls", () => {
  it("shows sequence, reason name, intent summary, rename, and create as separate actions", () => {
    const version = {
      ...resolvePublishingActiveVersion(emptyPublishingDraftState(1)),
      displayName: "给招聘者看的版本",
    };
    const html = renderToStaticMarkup(
      <PublishingVersionControls
        versions={[version]}
        activeVersionId={version.versionId}
        activeIntent={{
          ...defaultPublishingNarrativeIntent(),
          primaryPurpose: "persuade",
          coreAudience: "招聘者",
        }}
        busy={false}
        canCreate
        onSwitch={vi.fn()}
        onRename={vi.fn()}
        onCreate={vi.fn()}
        onEditIntent={vi.fn()}
      />
    );

    expect(html).toContain("V1 · 给招聘者看的版本");
    expect(html).toContain("说服 · 招聘者");
    expect(html).toContain("重命名");
    expect(html).toContain("新版本名称（可选");
    expect(html).toContain("新建版本");
  });

  it("explains scoped loading without rendering the previous version as current", () => {
    const state = emptyPublishingDraftState(1);
    const version = resolvePublishingActiveVersion(state);
    const target = { ...version, versionId: "v2", sequence: 2, displayName: "公开发布" };
    const html = renderToStaticMarkup(
      <PublishingVersionControls
        versions={[version, target]}
        activeVersionId={version.versionId}
        activeIntent={defaultPublishingNarrativeIntent()}
        busy
        loadingVersionId="v2"
        canCreate
        onSwitch={vi.fn()}
        onRename={vi.fn()}
        onCreate={vi.fn()}
        onEditIntent={vi.fn()}
      />
    );
    expect(html).toContain("正在切换到 V2 · 公开发布");
    expect(html).toContain("旧版本内容不会暂时回显");
  });

  it("validates manual names while sequence keeps duplicate names distinguishable", () => {
    expect(publishingVersionNameError("   ")).toBe("版本名称不能为空");
    expect(publishingVersionNameError("a".repeat(81))).toContain("80");
    expect(publishingVersionNameError("公开发布")).toBeNull();
    expect(publishingVersionLabel({
      sequence: 2,
      displayName: "公开发布",
    } as never)).toBe("V2 · 公开发布");
  });
});
