import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CreationEditorShot } from "@/features/creationEditor/CreationEditorContext";
import {
  autoScrollElementAtPoint,
  autoScrollElementHorizontallyAtPoint,
  hasStoryboardScrollableDragPayload,
  scrollElementHorizontallyIntoView,
  StoryboardVideoThumbnail,
  STORYBOARD_MATRIX_ROWS,
  storyShotInsertIdentity,
  storyboardDragScrollSpeedMultiplier,
  storyboardMatrixSwapPlan,
  storyboardPreviewVideoTake,
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

  it("auto-scrolls the matrix horizontally while information is dragged", () => {
    let scrollLeft = 120;
    const element = {
      getBoundingClientRect: () => ({ left: 40, right: 440 }),
      scrollBy: ({ left }: { left: number }) => {
        scrollLeft += left;
      },
    } as unknown as HTMLElement;

    const left = autoScrollElementHorizontallyAtPoint(element, 48);
    const still = autoScrollElementHorizontallyAtPoint(element, 240);
    const right = autoScrollElementHorizontallyAtPoint(element, 432);

    expect(left).toBeLessThan(0);
    expect(still).toBe(0);
    expect(right).toBeGreaterThan(0);
    expect(scrollLeft).toBe(120 + left + right);
  });

  it("keeps the selected shot clear of the sticky matrix row labels", () => {
    const deltas: number[] = [];
    const scroller = {
      clientWidth: 444,
      scrollLeft: 76,
      getBoundingClientRect: () => ({ left: 64, right: 508 }),
      scrollBy: ({ left }: { left: number }) => deltas.push(left),
    } as unknown as HTMLElement;
    const coveredTarget = {
      offsetLeft: 76,
      offsetWidth: 224,
      getBoundingClientRect: () => ({ left: 64, right: 288 }),
    } as unknown as HTMLElement;

    expect(scrollElementHorizontallyIntoView(scroller, coveredTarget, 76)).toBe(
      -76
    );
    expect(deltas).toEqual([-76]);
  });

  it("keeps the full storyboard as shot columns with editable information rows", () => {
    expect(STORYBOARD_MATRIX_ROWS.map(row => row.field)).toEqual([
      "dialogue",
      "intent",
      "action",
      "performance",
      "cameraMove",
      "videoStart",
      "videoEnd",
      "sound",
      "transitionOut",
      "videoPrompt",
    ]);
  });

  it("prefers the adopted playable video take for storyboard previews", () => {
    const shot = {
      selectedVideoTake: {
        id: 22,
        status: "available",
        videoUrl: "/api/videos/take-22.mp4",
        isTimelineSelected: true,
      },
      videoTakes: [
        {
          id: 21,
          status: "available",
          videoUrl: "/api/videos/take-21.mp4",
          isTimelineSelected: false,
        },
        {
          id: 22,
          status: "available",
          videoUrl: "/api/videos/take-22.mp4",
          isTimelineSelected: true,
        },
      ],
    } as unknown as CreationEditorShot;

    expect(storyboardPreviewVideoTake(shot)?.id).toBe(22);
  });

  it("keeps the current image visible over an unselected video candidate", () => {
    const shot = {
      imageUrl: "/api/images/current-shot.webp",
      videoTakes: [
        {
          id: 21,
          status: "available",
          videoUrl: "/api/videos/take-21.mp4",
          isTimelineSelected: false,
        },
      ],
    } as unknown as CreationEditorShot;

    expect(storyboardPreviewVideoTake(shot)).toBeUndefined();
  });

  it("renders storyboard video thumbnails as video elements", () => {
    const markup = renderToStaticMarkup(
      createElement(StoryboardVideoThumbnail, {
        src: "/api/videos/take-22.mp4",
        poster: "/api/video-frames/22?atSec=0.000",
        active: true,
        label: "0102 视频缩略预览",
        className: "preview",
      })
    );

    expect(markup).toContain("<video");
    expect(markup).toContain('data-storyboard-video-preview="true"');
    expect(markup).toContain('src="/api/videos/take-22.mp4"');
  });

  it("plans a non-destructive field swap between two shot columns", () => {
    const base = {
      subject: "",
      action: "",
      dialogue: "",
      shotType: "",
      beat: "",
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
    };
    const shots = [
      { ...base, shotNo: 1, dialogue: "第一句" },
      { ...base, shotNo: 2, dialogue: "第二句" },
    ];

    expect(storyboardMatrixSwapPlan(shots, 0, 1, "dialogue")).toEqual({
      sourceValue: "第一句",
      targetValue: "第二句",
    });
    expect(storyboardMatrixSwapPlan(shots, 0, 0, "dialogue")).toBeNull();
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
    expect(boardSource).toContain("labelForShotNo(shotNo)");
    expect(boardSource).toContain("displayShotCode");
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
    expect(boardSource).toContain("const label = `删除 ${shotLabel}`");
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
    const settingsSource = readFileSync(
      resolve(
        root,
        "client/src/features/storyAgent/views/GenerationSettingsPanel.tsx"
      ),
      "utf8"
    );

    expect(boardSource).toContain("故事版看板");
    expect(boardSource).toContain("StoryboardReviewBoard");
    expect(boardSource).not.toContain("<StoryboardReviewBoard");
    expect(panelSource).toContain("<StoryboardReviewBoard");
    expect(panelSource).toContain("整理好求职优势后");
    expect(boardSource).toContain("GenerationSettingsPanel");
    expect(settingsSource).toContain('aria-label="剧本生成设置"');
    expect(settingsSource).toContain('aria-label="美术生成设置"');
    expect(boardSource).toContain("generationProfile");
    expect(boardSource).toContain(
      "generateScript(undefined, generationProfile)"
    );
    expect(boardSource).toContain("onSelectArtLibrary");
    expect(settingsSource).toContain("先用于本次生成，故事保存后可绑定");
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
    expect(boardSource).toContain("importStoryboardMediaFiles");
    expect(boardSource).toContain("StoryboardMediaDropOverlay");
    expect(boardSource).toContain("data-storyboard-media-drop-target");
    expect(boardSource).toContain("视频已进入动态分镜");
    expect(boardSource).toContain("storyboardDragScrollSpeedMultiplier");
    expect(boardSource).toContain("添加镜头");
    expect(boardSource).toContain('useState<"full" | "simple">');
    expect(boardSource).toContain("openShotEditor");
    expect(boardSource).toContain("故事版看板视图");
    expect(boardSource).toContain('setViewMode("simple")');
    expect(boardSource).toContain("完整故事版横向分镜表");
    expect(boardSource).toContain("STORYBOARD_MATRIX_ROWS");
    expect(boardSource).toContain("gridTemplateColumns");
    expect(boardSource).toContain('gridColumn: "2 / -1"');
    expect(boardSource).toContain('displayMode="matrix"');
    expect(boardSource).toContain("视频制作表格行");
    expect(boardSource).not.toContain("max-h-[48%]");
    expect(boardSource).not.toContain('behavior: "smooth"');
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
    expect(materialBasketSource).toContain("素材 / 图生视频 / Take");
    expect(materialBasketSource).toContain('displayMode === "matrix"');
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
