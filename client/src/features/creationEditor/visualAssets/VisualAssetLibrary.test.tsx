import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { StoryVisualAssets } from "@shared/visualAssets";

vi.stubGlobal("React", React);

const api = vi.hoisted(() => ({
  data: undefined as
    | { storyId: number; revision: number; aggregate: StoryVisualAssets }
    | undefined,
}));

vi.mock("@/lib/trpc", () => {
  const mutation = () => ({ isPending: false, mutateAsync: vi.fn() });
  return {
    trpc: {
      useUtils: () => ({
        visualAssets: { read: { invalidate: vi.fn() } },
        storyAgent: { storyMaterialState: { invalidate: vi.fn() } },
      }),
      visualAssets: {
        read: {
          useQuery: () => ({
            data: api.data,
            isLoading: false,
            error: null,
            refetch: vi.fn(),
          }),
        },
        createDraft: { useMutation: mutation },
        createVersion: { useMutation: mutation },
        lockVersion: { useMutation: mutation },
        forkVersion: { useMutation: mutation },
        deleteVersion: { useMutation: mutation },
        deleteAsset: { useMutation: mutation },
        analyzeVersion: { useMutation: mutation },
        resolveConflicts: { useMutation: mutation },
        quoteCanonicalBoard: { useMutation: mutation },
        generateCanonicalBoard: { useMutation: mutation },
        quoteView: { useMutation: mutation },
        regenerateView: { useMutation: mutation },
        proposeBindings: { useMutation: mutation },
        confirmBindings: { useMutation: mutation },
      },
    },
  };
});

import VisualAssetLibrary, {
  visualAssetBoardConfirmationMessage,
  visualAssetLockBlockers,
} from "./VisualAssetLibrary";

const draftVersion = {
  id: "character-v1",
  version: 1,
  status: "draft" as const,
  references: [{ imageId: 101, role: "character-identity" as const }],
  legacyReferenceIds: [],
  fixedFacts: {
    kind: "character" as const,
    face: "",
    hair: "",
    outfit: "",
    accessories: [],
  },
  allowedVariations: ["景别"],
  conflicts: [],
  views: [],
  createdAt: 1,
};

describe("VisualAssetLibrary", () => {
  it("describes all four paid character views before confirmation", () => {
    const message = visualAssetBoardConfirmationMessage("character", {
      candidateCount: 4,
      estimatedCny: 5.96,
    });

    expect(message).toContain("分 4 次生成");
    expect(message).toContain("正面头部特写");
    expect(message).toContain("正面全身");
    expect(message).toContain("严格 90° 侧面全身");
    expect(message).toContain("背面全身");
    expect(message).toContain("¥5.96");
  });

  it("makes the standard board and individual views available for large preview", () => {
    api.data = {
      storyId: 7,
      revision: 5,
      aggregate: {
        schemaVersion: 2,
        legacyMigrationVersion: 1,
        assets: [
          {
            id: "character-a",
            kind: "character",
            name: "开发者女孩",
            versions: [
              {
                ...draftVersion,
                status: "review",
                boardImageId: 201,
                views: [
                  {
                    id: "character-v1-front",
                    role: "front",
                    imageId: 202,
                    status: "unknown",
                    failureReason: "自动质检超时",
                  },
                ],
              },
            ],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        proposals: [],
        bindings: [],
        operations: [],
      },
    };

    const html = renderToStaticMarkup(
      <VisualAssetLibrary
        storyId={7}
        images={[
          { id: 201, imageUrl: "/board.png", label: "标准板" },
          { id: 202, imageUrl: "/front.png", label: "正面" },
        ]}
      />
    );

    expect(html).toContain('aria-label="查看 开发者女孩 标准板大图"');
    expect(html).toContain('aria-label="查看 开发者女孩 front 大图"');
    expect(html).toContain('aria-label="重新生成 开发者女孩 正面全身"');
    expect(html).toContain("查看大图");
  });

  it("shows asset cards without the redundant library instructions", () => {
    api.data = {
      storyId: 7,
      revision: 2,
      aggregate: {
        schemaVersion: 2,
        legacyMigrationVersion: 1,
        assets: [
          {
            id: "character-a",
            kind: "character",
            name: "红外套人物",
            versions: [draftVersion],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        proposals: [],
        bindings: [],
        operations: [],
      },
    };

    const html = renderToStaticMarkup(
      <VisualAssetLibrary
        storyId={7}
        images={[{ id: 101, imageUrl: "/101.png", label: "图片 #101" }]}
      />
    );

    expect(html).toContain("红外套人物");
    expect(html).toContain("尚未生成人物标准视图");
    expect(html).toContain("锁定前还需");
    expect(html).not.toContain("锁定人物、场景和美术风格");
    expect(html).not.toContain("使用顺序");
    expect(html).not.toContain("同一镜头只需关联一次，图片和视频生成都会使用");
    expect(html).toContain("disabled");
  });

  it("stacks asset cards in the compact drawer instead of forcing a horizontal strip", () => {
    api.data = {
      storyId: 7,
      revision: 2,
      aggregate: {
        schemaVersion: 2,
        legacyMigrationVersion: 1,
        assets: [
          {
            id: "character-a",
            kind: "character",
            name: "红外套人物",
            versions: [draftVersion],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        proposals: [],
        bindings: [],
        operations: [],
      },
    };

    const html = renderToStaticMarkup(
      <VisualAssetLibrary storyId={7} images={[]} compact />
    );

    expect(html).toContain('data-visual-asset-layout="drawer-stack"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("min-w-[720px]");
    expect(html).not.toContain("w-[430px]");
  });

  it("offers all required character standard views after reference analysis", () => {
    api.data = {
      storyId: 7,
      revision: 3,
      aggregate: {
        schemaVersion: 2,
        legacyMigrationVersion: 1,
        assets: [
          {
            id: "character-a",
            kind: "character",
            name: "红外套人物",
            versions: [
              {
                ...draftVersion,
                status: "review",
                fixedFacts: {
                  kind: "character",
                  face: "圆脸",
                  hair: "齐耳短发",
                  outfit: "红外套",
                  accessories: [],
                },
              },
            ],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        proposals: [],
        bindings: [],
        operations: [],
      },
    };

    const html = renderToStaticMarkup(
      <VisualAssetLibrary storyId={7} images={[]} currentStableShotId="shot-01" />
    );

    expect(html).toContain("生成人物标准视图");
  });

  it("reports unresolved conflicts separately from missing views", () => {
    const blockers = visualAssetLockBlockers(
      { kind: "character" },
      {
        ...draftVersion,
        fixedFacts: {
          kind: "character",
          face: "圆脸",
          hair: "齐耳短发",
          outfit: "红外套",
          accessories: [],
        },
        conflicts: [
          {
            field: "hair",
            descriptions: ["短发", "长发"],
            sourceImageIds: [101, 102],
          },
        ],
      }
    );

    expect(blockers).toContain("参考图冲突尚未处理");
    expect(blockers).toContain("标准视图尚未生成");
  });

  it("keeps the standard-view next step visible while character conflicts await confirmation", () => {
    api.data = {
      storyId: 7,
      revision: 4,
      aggregate: {
        schemaVersion: 2,
        legacyMigrationVersion: 1,
        assets: [
          {
            id: "character-a",
            kind: "character",
            name: "女主",
            versions: [
              {
                ...draftVersion,
                status: "review",
                fixedFacts: {
                  kind: "character",
                  face: "椭圆脸、浅色眼眸",
                  hair: "黑色齐耳短发",
                  outfit: "白色露背长裙",
                  accessories: [],
                },
                conflicts: [
                  {
                    field: "outfit",
                    descriptions: ["白色露背长裙", "暖黄色短款上衣"],
                    sourceImageIds: [101, 102],
                  },
                ],
              },
            ],
            createdAt: 1,
            updatedAt: 1,
          },
        ],
        proposals: [],
        bindings: [],
        operations: [],
      },
    };

    const html = renderToStaticMarkup(
      <VisualAssetLibrary storyId={7} images={[]} currentStableShotId="shot-01" />
    );

    expect(html).toContain("下一步：确认人物固定造型");
    expect(html).toContain("推荐：使用已整理的固定造型");
    expect(html).toContain("确认推荐造型，继续生成标准视图");
    expect(html).toContain("确认造型后，此处直接生成人物标准视图");
  });
});
