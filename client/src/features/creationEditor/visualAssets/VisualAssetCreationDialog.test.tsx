import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("React", React);

import VisualAssetCreationDialog, {
  visualAssetReferenceResponsibilityLabel,
  visualAssetReferencesFor,
  visualAssetKindLabel,
} from "./VisualAssetCreationDialog";

describe("VisualAssetCreationDialog", () => {
  it("shows pets as their own warehouse category instead of people", () => {
    expect(visualAssetKindLabel("character")).toBe("人物");
    expect(visualAssetKindLabel("pet")).toBe("宠物");
  });

  it("makes each asset type's reference responsibility explicit", () => {
    expect(visualAssetReferenceResponsibilityLabel("character")).toContain(
      "不控制构图和场景"
    );
    expect(visualAssetReferenceResponsibilityLabel("pet")).toContain(
      "不控制人物、构图和场景"
    );
    expect(visualAssetReferenceResponsibilityLabel("scene")).toContain(
      "不改写人物"
    );
    expect(visualAssetReferenceResponsibilityLabel("style")).toContain(
      "不复刻主体与布局"
    );
  });

  it("submits one explicit responsibility for every selected image", () => {
    expect(visualAssetReferencesFor("scene", [101, 102, 101])).toEqual([
      { imageId: 101, role: "scene-space" },
      { imageId: 102, role: "scene-space" },
    ]);
  });

  it("forces asset type selection before reference images", () => {
    const html = renderToStaticMarkup(
      <VisualAssetCreationDialog
        open
        images={[]}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    expect(html).toContain("人物");
    expect(html).toContain("宠物");
    expect(html).toContain("场景");
    expect(html).toContain("美术风格");
    expect(html).not.toContain("选择参考图");
  });

  it("shows only current-Story image IDs after the type is fixed", () => {
    const html = renderToStaticMarkup(
      <VisualAssetCreationDialog
        open
        initialKind="character"
        initialName="红外套人物"
        images={[
          { id: 101, imageUrl: "/images/101.png", label: "镜头 1 · 图片 #101" },
          { id: 102, imageUrl: "/images/102.png", label: "未绑定 · 图片 #102" },
        ]}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    expect(html).toContain("选择参考图并确认逐图职责");
    expect(html).toContain("红外套人物");
    expect(html).toContain("图片 #101");
    expect(html).toContain("图片 #102");
    expect(html).toContain("AI 不会把人物、宠物、场景和画风混在一起分析");
  });
});
