import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  CreationEditorImage,
  CreationEditorShot,
} from "@/features/creationEditor/CreationEditorContext";
import {
  StoryboardVideoThumbnail,
  STORYBOARD_MATRIX_ROWS,
  storyboardMatrixSwapPlan,
  storyboardMatrixTextareaHeight,
  storyboardPreviewVideoTake,
} from "./StoryCardsBoard";
import {
  autoScrollElementAtPoint,
  autoScrollElementHorizontallyAtPoint,
  hasStoryboardScrollableDragPayload,
  quickShotVideoRenderPlan,
  scrollElementHorizontallyIntoView,
  storyboardCharacterContinuityGenerationParams,
  storyboardCharacterContinuityReference,
  storyboardDragScrollSpeedMultiplier,
  storyboardExplicitImageInstruction,
  storyboardFrameParamsAfterDelete,
  storyboardFrameOrderGenerationParams,
  storyboardFrameOrdersAfterMove,
  storyboardFrameRoleForImage,
  storyboardFrameRoleGenerationParams,
  storyboardShotFrameImages,
  storyboardInheritedStartEndGenerationParams,
  storyboardRenderShotWithDraft,
  storyboardStartEndGenerationParams,
  storyboardStartEndFrameIssue,
  storyboardVideoIntentPatch,
  storyShotInsertIdentity,
} from "./storyboardReviewModel";
import {
  shotVideoDirectorInputSignature,
  shotVideoWorkflowLabel,
  shotVideoWorkflowStep,
} from "./ShotMaterialBasket";

const root = process.cwd();

describe("StoryCardsBoard intent entry", () => {
  it("makes video generation an explicit analyze, apply, then submit workflow", () => {
    expect(
      shotVideoWorkflowStep({
        hasAnalysis: false,
        analysisApplied: false,
        hasProcessingTake: false,
      })
    ).toBe("analyze");
    expect(shotVideoWorkflowLabel("analyze")).toBe("1 分析导演方案");
    expect(
      shotVideoWorkflowStep({
        hasAnalysis: true,
        analysisApplied: false,
        hasProcessingTake: false,
      })
    ).toBe("apply");
    expect(shotVideoWorkflowLabel("apply")).toBe("2 应用导演方案");
    expect(
      shotVideoWorkflowStep({
        hasAnalysis: true,
        analysisApplied: true,
        hasProcessingTake: false,
      })
    ).toBe("generate");
    expect(shotVideoWorkflowLabel("generate")).toBe("3 确认费用并生成");
    expect(
      shotVideoWorkflowStep({
        hasAnalysis: true,
        analysisApplied: true,
        hasProcessingTake: true,
      })
    ).toBe("refresh");
  });

  it("persists the user-confirmed character version for later image and video renders", () => {
    const generationParams = storyboardCharacterContinuityGenerationParams(
      JSON.stringify({ durationSec: 5 }),
      {
        key: "anchor",
        label: "SheSelf 人物基准",
        detail: "故事人物基准",
        imageUrl: "https://img.example/hero.webp",
        kind: "anchor",
      }
    );

    expect(JSON.parse(generationParams)).toMatchObject({
      durationSec: 5,
      characterContinuity: {
        source: "anchor",
        label: "SheSelf 人物基准",
        imageUrl: "https://img.example/hero.webp",
      },
    });
    expect(storyboardCharacterContinuityReference(generationParams)).toEqual({
      label: "SheSelf 人物基准",
      imageUrl: "https://img.example/hero.webp",
    });
  });

  it("invalidates a director plan when the shot intent changes, but not for a final prompt edit", () => {
    const base = {
      action: "人物停在画面中央",
      cameraMove: "固定机位",
      videoPrompt: "first final prompt",
    };
    expect(
      shotVideoDirectorInputSignature({
        ...base,
        action: "女主头上出现一只眼睛，相机给眼睛特写",
      })
    ).not.toBe(shotVideoDirectorInputSignature(base));
    expect(
      shotVideoDirectorInputSignature({
        ...base,
        videoPrompt: "user edited final prompt",
      })
    ).toBe(shotVideoDirectorInputSignature(base));
  });

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

  it("keeps only user-actionable rows editable in the full storyboard", () => {
    expect(STORYBOARD_MATRIX_ROWS.map(row => row.field)).toEqual([
      "dialogue",
      "action",
      "performance",
      "cameraMove",
      "sound",
      "transitionOut",
      "promptDraft",
      "videoPrompt",
    ]);
  });

  it("uses the storyboard image requirement as an exact generation instruction", () => {
    expect(
      storyboardExplicitImageInstruction(
        { promptDraft: "旧要求" },
        "把背景调亮，人物、发型和物体都不要变。"
      )
    ).toBe("把背景调亮，人物、发型和物体都不要变。");
    expect(
      storyboardExplicitImageInstruction({ promptDraft: "  保持全片质感  " })
    ).toBe("保持全片质感");
  });

  it("uses the first and last storyboard images as the locked video frames", () => {
    const generationParams = storyboardStartEndGenerationParams(
      "",
      [
        { id: 41, imageUrl: "/frames/first.webp" },
        { id: 42, imageUrl: "/frames/middle.webp" },
        { id: 43, imageUrl: "/frames/last.webp" },
      ],
      4_200
    );

    expect(JSON.parse(generationParams ?? "{}")).toMatchObject({
      frameMode: "start_end",
      firstFrameImageId: 41,
      lastFrameImageId: 43,
      durationSec: 4,
      resolution: "1080p",
    });
    expect(
      storyboardShotFrameImages({
        shotNo: 1,
        shotKey: "story-1165:0101",
        generationParams,
        imageVersions: [
          { id: 43, imageUrl: "/frames/last.webp" },
          { id: 41, imageUrl: "/frames/first.webp" },
          { id: 42, imageUrl: "/frames/middle.webp" },
        ],
      } as unknown as CreationEditorShot).map(image => image.id)
    ).toEqual([41, 42, 43]);
  });

  it("blocks a paid rerender when a start-end shot only has a middle reference", () => {
    expect(
      storyboardStartEndFrameIssue(
        JSON.stringify({
          providerIntent: "vidu-start-end",
          storyboardFrameRoles: { referenceImageIds: [1365] },
          referenceFrameImageIds: [1365],
        }),
        [{ id: 1365, imageUrl: "/frames/reference.webp" }]
      )
    ).toContain("只有中间参考图，缺少首帧和尾帧");

    expect(
      storyboardStartEndFrameIssue(JSON.stringify({ motion: "high" }), [
        { id: 1365, imageUrl: "/frames/first.webp" },
      ])
    ).toBeNull();
  });

  it("borrows the previous tail and next head when the current shot only has a middle reference", () => {
    const currentImages = [
      { id: 1365, imageUrl: "/frames/current-middle.webp" },
    ];
    const generationParams = storyboardInheritedStartEndGenerationParams(
      JSON.stringify({
        providerIntent: "vidu-start-end",
        storyboardFrameRoles: { referenceImageIds: [1365] },
        referenceFrameImageIds: [1365],
      }),
      currentImages,
      {
        generationParams: JSON.stringify({
          storyboardFrameRoles: {
            firstImageId: 1201,
            lastImageId: 1202,
            referenceImageIds: [],
          },
        }),
        images: [
          { id: 1201, imageUrl: "/frames/previous-first.webp" },
          { id: 1202, imageUrl: "/frames/previous-last.webp" },
        ],
        stableShotId: "shot-0200",
        cueCode: "0200",
      },
      {
        generationParams: JSON.stringify({
          storyboardFrameRoles: {
            firstImageId: 1401,
            lastImageId: 1402,
            referenceImageIds: [],
          },
        }),
        images: [
          { id: 1401, imageUrl: "/frames/next-first.webp" },
          { id: 1402, imageUrl: "/frames/next-last.webp" },
        ],
        stableShotId: "shot-0202",
        cueCode: "0202",
      },
      4_600
    );

    expect(JSON.parse(generationParams ?? "{}")).toMatchObject({
      frameMode: "start_end",
      firstFrameImageId: 1202,
      lastFrameImageId: 1401,
      referenceFrameImageIds: [1365],
      durationSec: 5,
      startEndFrameSources: {
        policyVersion: "neighbor-boundary-frames/v1",
        first: {
          source: "previous-last",
          imageId: 1202,
          stableShotId: "shot-0200",
        },
        last: {
          source: "next-first",
          imageId: 1401,
          stableShotId: "shot-0202",
        },
      },
    });
    expect(
      storyboardStartEndFrameIssue(generationParams, currentImages)
    ).toBeNull();
  });

  it("persists explicit first, last, and reference roles for storyboard frames", () => {
    const images = [
      { id: 41, imageUrl: "/frames/a.webp" },
      { id: 42, imageUrl: "/frames/b.webp" },
      { id: 43, imageUrl: "/frames/c.webp" },
    ];
    const withFirst = storyboardFrameRoleGenerationParams(
      "",
      images,
      42,
      "first"
    );
    const withReference = storyboardFrameRoleGenerationParams(
      withFirst,
      images,
      41,
      "reference"
    );
    const parsed = JSON.parse(withReference);

    expect(parsed).toMatchObject({
      frameMode: "start_end",
      firstFrameImageId: 42,
      lastFrameImageId: 43,
      storyboardFrameRoles: {
        firstImageId: 42,
        lastImageId: 43,
        referenceImageIds: [41],
      },
    });
    const ordered = storyboardShotFrameImages({
      shotNo: 1,
      shotKey: "story-1165:0101",
      generationParams: withReference,
      imageVersions: images,
    } as unknown as CreationEditorShot);
    expect(ordered.map(image => image.id)).toEqual([42, 41, 43]);
    expect(storyboardFrameRoleForImage(withReference, ordered, 41)).toBe(
      "reference"
    );
  });

  it("reassigns the remaining frame roles when a storyboard image is deleted", () => {
    const images = [
      { id: 41, imageUrl: "/frames/a.webp" },
      { id: 42, imageUrl: "/frames/b.webp" },
      { id: 43, imageUrl: "/frames/c.webp" },
    ];
    const generationParams = storyboardFrameRoleGenerationParams(
      "",
      images,
      42,
      "first"
    );
    const afterDelete = JSON.parse(
      storyboardFrameParamsAfterDelete(generationParams, images, 42)
    );

    expect(afterDelete).toMatchObject({
      frameMode: "start_end",
      firstFrameImageId: 41,
      lastFrameImageId: 43,
      storyboardFrameRoles: {
        firstImageId: 41,
        lastImageId: 43,
      },
    });
  });

  it("moves a frame between shots and refreshes both first-last orders", () => {
    const moved = storyboardFrameOrdersAfterMove(
      [
        { id: 41, imageUrl: "/frames/source-first.webp" },
        { id: 42, imageUrl: "/frames/source-last.webp" },
      ] as CreationEditorImage[],
      [
        { id: 71, imageUrl: "/frames/target-first.webp" },
      ] as CreationEditorImage[],
      42
    );

    expect(moved?.sourceImages.map(image => image.id)).toEqual([41]);
    expect(moved?.targetImages.map(image => image.id)).toEqual([71, 42]);
    expect(
      JSON.parse(
        storyboardFrameOrderGenerationParams(
          JSON.stringify({
            frameMode: "start_end",
            firstFrameImageId: 41,
            lastFrameImageId: 42,
            model: "kling",
          }),
          moved?.sourceImages ?? []
        )
      )
    ).toEqual({ model: "kling" });
    expect(
      JSON.parse(
        storyboardFrameOrderGenerationParams(
          "",
          moved?.targetImages ?? [],
          4_200
        )
      )
    ).toMatchObject({
      frameMode: "start_end",
      firstFrameImageId: 71,
      lastFrameImageId: 42,
    });
  });

  it("keeps shared storyboard rows compact until the active cell is being edited", () => {
    expect(storyboardMatrixTextareaHeight(10, "dialogue")).toBe(28);
    expect(storyboardMatrixTextareaHeight(72, "dialogue")).toBe(44);
    expect(storyboardMatrixTextareaHeight(999, "videoPrompt")).toBe(60);
    expect(storyboardMatrixTextareaHeight(72, "dialogue", true)).toBe(72);
    expect(storyboardMatrixTextareaHeight(999, "dialogue", true)).toBe(112);
    expect(storyboardMatrixTextareaHeight(999, "videoPrompt", true)).toBe(176);
  });

  it("builds a paid quick rerender plan from the current shot text", () => {
    const plan = quickShotVideoRenderPlan(
      {
        shotNo: 1,
        shotKey: "story-1165:0101",
        imageId: 101,
        imageUrl: "/api/images/101.webp",
        action: "女主快速撑开属于自己的空间，墙面结构持续变化",
        cameraMove: "稳定器从中景贴近，随后跟随双臂向两侧展开",
        videoPrompt: "空间变化必须和人物撑开的动作同步",
        durationMs: 4_200,
        emotion: "挣脱",
      } as unknown as CreationEditorShot,
      []
    );

    expect(plan.durationSec).toBe(4);
    expect(plan.motion).toBe("high");
    expect(plan.aspectRatio).toBe("1:1");
    expect(plan.estimatedCny).toBeGreaterThan(0);
    expect(plan.renderDecision.strategy).toBe("paid-302");
    expect(plan.missing).toEqual([]);
    expect(plan.prompt).toContain("女主快速撑开属于自己的空间");
    expect(plan.prompt).toContain("稳定器从中景贴近");
    expect(plan.prompt).not.toContain("空间变化必须和人物撑开的动作同步");
  });

  it("routes a simple scale and position change to the free local renderer", () => {
    const plan = quickShotVideoRenderPlan(
      {
        shotNo: 2,
        shotKey: "story-1165:0102",
        imageId: 102,
        imageUrl: "/api/images/102.webp",
        action: "人物与环境保持静止",
        cameraMove: "数码放大画面并轻微向左平移",
        videoPrompt: "保留原图，只调整构图",
        durationMs: 4_200,
      } as unknown as CreationEditorShot,
      []
    );

    expect(plan.estimatedCny).toBe(0);
    expect(plan.renderDecision).toMatchObject({
      strategy: "local-transform",
      localMotion: { kind: "zoom-pan" },
    });
  });

  it("persists the current storyboard direction before rerendering", () => {
    expect(
      storyboardVideoIntentPatch(
        {
          action: "女主抬头，眼睛在画面上方出现",
          performance: "先屏息，再缓慢抬眼",
          environmentMotion: "背景保持不动",
          cameraMove: "从人物中景推到眼睛特写",
          cameraPath: "沿画面中心轴向前",
          subjectPath: "人物停在原位",
          videoStart: "女主位于画面下半部",
          videoEnd: "眼睛占据画面中心",
          transitionIn: "承接上一镜的抬头动作",
          transitionOut: "眼睛构图匹配下一镜",
          videoPrompt: "相机跟随视线抬升后推进",
          negativePrompt: "不要新增人物",
        } as unknown as CreationEditorShot,
        '{"frameMode":"start_end"}'
      )
    ).toEqual({
      action: "女主抬头，眼睛在画面上方出现",
      performance: "先屏息，再缓慢抬眼",
      environmentMotion: "背景保持不动",
      cameraMove: "从人物中景推到眼睛特写",
      cameraPath: "沿画面中心轴向前",
      subjectPath: "人物停在原位",
      videoStart: "女主位于画面下半部",
      videoEnd: "眼睛占据画面中心",
      transitionIn: "承接上一镜的抬头动作",
      transitionOut: "眼睛构图匹配下一镜",
      videoPrompt: "相机跟随视线抬升后推进",
      negativePrompt: "不要新增人物",
      generationParams: '{"frameMode":"start_end"}',
    });
  });

  it("uses the live matrix draft when rerender is clicked before blur save finishes", () => {
    const effective = storyboardRenderShotWithDraft(
      {
        shotNo: 9,
        stableShotId: "manual-sh03",
        action: "旧动作",
        cameraMove: "旧运镜",
        videoPrompt: "保留既有视频提示",
      } as unknown as CreationEditorShot,
      {
        shotNo: 9,
        stableShotId: "manual-sh03",
        action: "已保存但尚未同步到生成镜头的动作",
        cameraMove: "当前表格里的运镜",
      } as unknown as StoryShot,
      {
        action: "女主在黑暗中撑出自己的区域，相机运动加快",
      }
    );

    expect(effective.action).toBe("女主在黑暗中撑出自己的区域，相机运动加快");
    expect(effective.cameraMove).toBe("当前表格里的运镜");
    expect(effective.videoPrompt).toBe("保留既有视频提示");
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
      resolve(
        root,
        "client/src/features/storyAgent/views/StoryboardReviewBoard.tsx"
      ),
      "utf8"
    );

    expect((boardSource.match(/<AddShotButton/g) ?? []).length).toBe(2);
    expect(boardSource).toContain("labelForShotNo(shotNo)");
    expect(boardSource).toContain("displayShotCode");
    expect(boardSource).toContain("后添加镜头");
  });

  it("shows video rendering, failure, candidate and adoption states in the storyboard", () => {
    const boardSource = readFileSync(
      resolve(
        root,
        "client/src/features/storyAgent/views/StoryboardReviewBoard.tsx"
      ),
      "utf8"
    );

    expect(boardSource).toContain('data-video-take-stage="submitting"');
    expect(boardSource).toContain("videoTakeProgress(take)");
    expect(boardSource).toContain("onRefreshShotVideoStatus(take.id)");
    expect(boardSource).toContain("onAdoptVideoTake({");
    expect(boardSource).toContain("进入时间线");
  });

  it("keeps manual shot deletion available in both storyboard views", () => {
    const boardSource = readFileSync(
      resolve(
        root,
        "client/src/features/storyAgent/views/StoryboardReviewBoard.tsx"
      ),
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
    const cardBoardSource = readFileSync(
      resolve(root, "client/src/features/storyAgent/views/StoryCardsBoard.tsx"),
      "utf8"
    );
    const reviewSource = readFileSync(
      resolve(
        root,
        "client/src/features/storyAgent/views/StoryboardReviewBoard.tsx"
      ),
      "utf8"
    );
    const reviewModelSource = readFileSync(
      resolve(
        root,
        "client/src/features/storyAgent/views/storyboardReviewModel.ts"
      ),
      "utf8"
    );
    const boardSource = `${cardBoardSource}\n${reviewSource}\n${reviewModelSource}`;
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

    expect(reviewSource).toContain("故事版看板");
    expect(reviewSource).toContain("export function StoryboardReviewBoard");
    expect(reviewSource).toContain('from "./storyboardReviewModel"');
    expect(reviewModelSource).not.toContain("function StoryboardReviewBoard");
    expect(cardBoardSource).not.toContain("StoryboardReviewBoard");
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
    expect(boardSource).not.toContain("ShotMaterialBasket");
    expect(boardSource).toContain("embeddedEditorMode");
    expect(boardSource).toContain("videoPreviewTake");
    expect(boardSource).toContain("缩略预览");
    expect(boardSource).toContain("onMarkVideoTakeUnusable");
    expect(boardSource).toContain("onInsertShotAfter");
    expect(panelSource).toContain("insertPersistedShotAfter");
    expect(boardSource).toContain("onDeleteShot");
    expect(panelSource).toContain("deletePersistedShot");
    expect(panelSource).toContain("onMoveVideoTake={moveVideoTake}");
    expect(panelSource).toContain("onMoveStoryImage={assignStoryImageToShot}");
    expect(boardSource).toContain("autoScrollElementAtPoint");
    expect(boardSource).toContain("boardScrollRef");
    expect(boardSource).toContain("storyShotInsertIdentity");
    expect(boardSource).toContain("importStoryboardMediaFiles");
    expect(boardSource).toContain("writeStoryboardImageDragPayload");
    expect(boardSource).toContain("readStoryboardImageDragPayload");
    expect(boardSource).toContain("onMoveStoryImage");
    expect(boardSource).toContain("onEditImage");
    expect(boardSource).toContain("imageClipEditorTargetForShot");
    expect(boardSource).toContain("双击编辑图片");
    expect(panelSource).toContain("onEditImage={onEditImage}");
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
    expect(boardSource).toContain('data-storyboard-shot-header="two-row"');
    expect(boardSource).toContain('data-storyboard-shot-actions="true"');
    expect(boardSource).toContain(
      'data-storyboard-media-layout="start-end-strip"'
    );
    expect(boardSource).toContain('data-storyboard-media-height="fixed"');
    expect(boardSource).toContain("data-storyboard-frame-role");
    expect(boardSource).toContain("画面");
    expect(boardSource).toContain("h-[75px]");
    expect(boardSource).toContain("h-[59px] w-[59px]");
    expect(boardSource).toContain("storyboard-video-menu-clip-");
    expect(boardSource).toContain("storyboard-video-menu-take-");
    expect(boardSource).toContain("从画面移除");
    expect(boardSource).toContain("onRemoveTimelineVideoClip");
    expect(panelSource).toContain(
      "onRemoveTimelineVideoClip={removeTimelineVideoClip}"
    );
    expect(boardSource).toContain("STORYBOARD_MATRIX_ROWS");
    expect(boardSource).toContain("gridTemplateColumns");
    expect(boardSource).not.toContain('gridColumn: "2 / -1"');
    expect(boardSource).not.toContain('displayMode="matrix"');
    expect(boardSource).not.toContain("视频制作表格行");
    expect(boardSource).toContain("渲染 4 张");
    expect(boardSource).toContain("渲染视频");
    expect(boardSource).toContain("explicitInstruction");
    expect(boardSource).toContain("quickShotVideoRenderPlan");
    expect(boardSource).toContain("estimateShotVideoCost");
    expect(boardSource).toContain("parseStartEndVideoConfig");
    expect(boardSource).toContain("rerenderRequestId");
    expect(boardSource).toContain("costConfirmation");
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
    expect(materialBasketSource).toContain("最终提交给视频模型的提示词");
    expect(materialBasketSource).toContain("只生成了导演方案，尚未提交视频");
    expect(materialBasketSource).not.toContain("slice(0, 3)");
    const matrixSource = readFileSync(
      resolve(
        root,
        "client/src/features/storyAgent/views/StoryboardMatrix.tsx"
      ),
      "utf8"
    );
    expect(matrixSource).not.toContain("onDraft");
    expect(matrixSource).toContain("onChange");
    expect(matrixSource).toContain("value={draftValue}");
    expect(matrixSource).toContain("rows={1}");
    expect(matrixSource).toContain("scrollHeight");
    expect(matrixSource).toContain("storyboardMatrixTextareaHeight");
    expect(matrixSource).not.toContain("defaultValue={currentValue}");
    expect(panelSource).not.toContain("onUpdateShotDraftField");
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
    expect(panelSource).toContain(
      "shotVideoProviderStatus={shotVideoProviderStatus}"
    );
    expect(boardSource).toContain("shotVideoProviderStatus?.ready");
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
