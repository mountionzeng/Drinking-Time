import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  autoScrollElementAtPoint,
  hasStoryboardScrollableDragPayload,
  storyShotInsertIdentity,
  storyboardDragScrollSpeedMultiplier,
} from "./StoryCardsBoard";

const root = process.cwd();

describe("StoryCardsBoard intent entry", () => {
  it("auto-scrolls the board while a take is dragged near vertical edges", () => {
    let scrollTop = 200;
    const element = {
      getBoundingClientRect: () => ({ top: 100, bottom: 500 }),
      scrollBy: ({ top }: { top: number }) => {
        scrollTop += top;
      },
    } as unknown as HTMLElement;

    const up = autoScrollElementAtPoint(element, 112);
    const still = autoScrollElementAtPoint(element, 300);
    const down = autoScrollElementAtPoint(element, 492);

    expect(up).toBeLessThan(0);
    expect(up).toBeLessThanOrEqual(-30);
    expect(still).toBe(0);
    expect(down).toBeGreaterThan(0);
    expect(down).toBeGreaterThanOrEqual(30);
    expect(scrollTop).toBe(200 + up + down);
  });

  it("auto-scrolls for local image file drags as well as video takes", () => {
    const fileDrag = { types: ["Files"] } as unknown as DataTransfer;
    const textDrag = { types: ["text/plain"] } as unknown as DataTransfer;

    expect(hasStoryboardScrollableDragPayload(fileDrag)).toBe(true);
    expect(hasStoryboardScrollableDragPayload(textDrag)).toBe(false);
  });

  it("accelerates edge scrolling during a long drag", () => {
    const deltas: number[] = [];
    const element = {
      getBoundingClientRect: () => ({ top: 100, bottom: 500 }),
      scrollBy: ({ top }: { top: number }) => {
        deltas.push(top);
      },
    } as unknown as HTMLElement;

    const initial = autoScrollElementAtPoint(
      element,
      492,
      storyboardDragScrollSpeedMultiplier(0)
    );
    const accelerated = autoScrollElementAtPoint(
      element,
      492,
      storyboardDragScrollSpeedMultiplier(2400)
    );

    expect(storyboardDragScrollSpeedMultiplier(0)).toBe(1);
    expect(storyboardDragScrollSpeedMultiplier(2400)).toBeGreaterThan(2);
    expect(storyboardDragScrollSpeedMultiplier(10_000)).toBeLessThanOrEqual(
      2.75
    );
    expect(accelerated).toBeGreaterThan(initial);
    expect(deltas).toEqual([initial, accelerated]);
  });

  it("uses the story shot identity, not a timeline-only id, for manual insertion", () => {
    expect(
      storyShotInsertIdentity(
        {
          shotNo: 4,
          subject: "白布遮住眼睛",
          action: "",
          dialogue: "",
          shotType: "",
          beat: "被观看",
          cameraAngle: "",
          cameraMove: "",
          location: "",
          timeLight: "",
          mood: "",
          sound: "",
          styleRef: "",
          note: "",
          emotion: "",
          sourceCardContent: "",
        },
        3
      )
    ).toBe("legacy-sh04-shot");

    expect(
      storyShotInsertIdentity(
        {
          stableShotId: "story-shot-04",
          shotIdentity: "story-shot-04",
          shotNo: 4,
          subject: "白布遮住眼睛",
          action: "",
          dialogue: "",
          shotType: "",
          beat: "被观看",
          cameraAngle: "",
          cameraMove: "",
          location: "",
          timeLight: "",
          mood: "",
          sound: "",
          styleRef: "",
          note: "",
          emotion: "",
          sourceCardContent: "",
        },
        3
      )
    ).toBe("story-shot-04");
  });

  it("keeps manual shot insertion available in both storyboard views", () => {
    const boardSource = readFileSync(
      resolve(root, "client/src/features/storyAgent/views/StoryCardsBoard.tsx"),
      "utf8"
    );

    expect((boardSource.match(/<AddShotButton/g) ?? []).length).toBe(2);
    expect(boardSource).toContain("已在 SH");
    expect(boardSource).toContain("后添加镜头");
  });

  it("keeps manual shot deletion available in both storyboard views", () => {
    const boardSource = readFileSync(
      resolve(root, "client/src/features/storyAgent/views/StoryCardsBoard.tsx"),
      "utf8"
    );
    const panelSource = readFileSync(
      resolve(root, "client/src/features/storyAgent/views/StoryboardPanel.tsx"),
      "utf8"
    );

    expect((boardSource.match(/<DeleteShotButton/g) ?? []).length).toBe(2);
    expect(boardSource).toContain("删除 SH");
    expect(boardSource).toContain("删除");
    expect(boardSource).toContain("至少保留一个镜头");
    expect(panelSource).toContain("deletePersistedShot");
    expect(panelSource).toContain("onDeleteShot");
  });

  it("does not keep the old StoryIntentGate entry point on the cards board", () => {
    const boardSource = readFileSync(
      resolve(root, "client/src/features/storyAgent/views/StoryCardsBoard.tsx"),
      "utf8"
    );

    expect(boardSource).not.toContain("StoryIntentGate");
    expect(boardSource).not.toContain("generateScript(confirmedIntent");
    expect(
      existsSync(
        resolve(
          root,
          "client/src/features/storyAgent/views/StoryIntentGate.tsx"
        )
      )
    ).toBe(false);
  });

  it("keeps the storyboard review board in the right-side storyboard panel", () => {
    const boardSource = readFileSync(
      resolve(root, "client/src/features/storyAgent/views/StoryCardsBoard.tsx"),
      "utf8"
    );
    const panelSource = readFileSync(
      resolve(root, "client/src/features/storyAgent/views/StoryboardPanel.tsx"),
      "utf8"
    );

    expect(boardSource).toContain("故事版看板");
    expect(boardSource).toContain("StoryboardReviewBoard");
    expect(boardSource).not.toContain("<StoryboardReviewBoard");
    expect(panelSource).toContain("<StoryboardReviewBoard");
    expect(panelSource).toContain("整理好求职优势后");
    expect(boardSource).toContain("GenerationSettingsPanel");
    expect(boardSource).toContain('aria-label="剧本生成设置"');
    expect(boardSource).toContain('aria-label="美术生成设置"');
    expect(boardSource).toContain("generationProfile");
    expect(boardSource).toContain(
      "generateScript(undefined, generationProfile)"
    );
    expect(boardSource).toContain("onSelectArtLibrary");
    expect(boardSource).toContain("先用于本次生成，故事保存后可绑定");
    expect(boardSource).not.toContain("叙事风格");
    expect(boardSource).not.toContain("美术风格");
    expect(boardSource).not.toContain("artDirection={artDirection}");
    expect(boardSource).not.toContain("onUpdateAllShotsField");
    expect(boardSource).not.toContain("导演理由");
    expect(boardSource).not.toContain("镜头任务");
    expect(boardSource).not.toContain("时间码");
    expect(boardSource).not.toContain("已在时间轴");
    expect(boardSource).toContain("ShotMaterialBasket");
    expect(boardSource).toContain("个 Take · 可用");
    expect(boardSource).toContain("embeddedEditorMode");
    expect(boardSource).toContain("videoPreviewTake");
    expect(boardSource).toContain("videoPreviewIsSelected");
    expect(boardSource).toContain("缩略预览");
    expect(boardSource).toContain("onMarkVideoTakeUnusable");
    expect(boardSource).toContain("onInsertShotAfter");
    expect(panelSource).toContain("insertPersistedShotAfter");
    expect(boardSource).toContain("onDeleteShot");
    expect(panelSource).toContain("deletePersistedShot");
    expect(panelSource).toContain("onMoveVideoTake={moveVideoTake}");
    expect(boardSource).toContain("autoScrollElementAtPoint");
    expect(boardSource).toContain("boardScrollRef");
    expect(boardSource).toContain("storyShotInsertIdentity");
    expect(boardSource).toContain("storyboardDragScrollSpeedMultiplier");
    expect(boardSource).toContain("添加镜头");
    expect(boardSource).toContain('useState<"full" | "simple">("simple")');
    expect(boardSource).toContain('setViewMode("simple")');
    expect(boardSource).toContain("openFullShot");
    expect(boardSource).not.toContain("storyboardScriptText");
    expect(boardSource).toContain("grid-cols-[72px_minmax(0,1fr)]");
    expect(boardSource).toContain("snap-y snap-mandatory");
    expect(boardSource).not.toContain("snap-x snap-mandatory");
    const materialBasketSource = readFileSync(
      resolve(
        root,
        "client/src/features/storyAgent/views/ShotMaterialBasket.tsx"
      ),
      "utf8"
    );
    expect(materialBasketSource).toContain(
      "视频的生成、预览和采用都在故事版看板完成"
    );
    expect(materialBasketSource).toContain("Take 总览");
    expect(materialBasketSource).toContain("标记不可用");
    expect(materialBasketSource).toContain("不再占用可用位置");
    expect(materialBasketSource).not.toContain("slice(0, 3)");
    expect(boardSource).toContain("confirmFictionStoryCards");
    expect(boardSource).toContain("pendingIntentDraft");
    expect(boardSource).toContain("hasPendingFictionIntent");
    expect(boardSource).toContain("handlePrimaryAction");
    expect(boardSource).toContain("primaryActionDisabled");
    expect(boardSource).toContain("确认意图");
    expect(boardSource).toContain("先确认虚构故事卡");
    expect(boardSource).toContain("确认故事卡");
    expect(boardSource).toContain("shouldGateFictionStoryboard");
    expect(panelSource).toContain("generateShotVideo");
    expect(panelSource).toContain("refreshShotVideoStatus");
    expect(panelSource).toContain("shotVideoProviderStatus");
    expect(boardSource).toContain(
      "shotVideoProviderStatus={shotVideoProviderStatus}"
    );
    expect(boardSource).toContain("latestStoryboardFrames");
    expect(boardSource).not.toContain("trpc.storyAgent.cycleStyle");
  });

  it("keeps the server recognizeIntent route for the background direct-speech entry", () => {
    const routerSource = readFileSync(
      resolve(root, "server/routers/storyAgent.ts"),
      "utf8"
    );

    expect(routerSource).toContain("recognizeIntent: protectedProcedure");
    expect(routerSource).toContain("recognizeStoryIntent");
  });
});
