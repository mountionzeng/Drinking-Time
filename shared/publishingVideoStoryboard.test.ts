import { describe, expect, it } from "vitest";
import {
  buildPublishingVideoPreview,
  canonicalizePublishingVideoParagraphs,
  classifyPublishingVideoImpact,
  validatePublishingVideoPreview,
  type PublishingVideoStoryboardShot,
} from "./publishingVideoStoryboard";

describe("publishing video storyboard domain", () => {
  it("canonicalizes CRLF, blank blocks, duplicate text, markdown, emoji and CTA paragraphs deterministically", () => {
    const first = canonicalizePublishingVideoParagraphs(
      "第一段。\r\n\r\n- 第二段\r\n继续。\r\n\r\n第一段。\r\n\r\n✨\r\n\r\n关注我，查看更多"
    );
    const second = canonicalizePublishingVideoParagraphs(
      "第一段。\n\n- 第二段\n继续。\n\n第一段。\n\n✨\n\n关注我，查看更多"
    );

    expect(first).toEqual(second);
    expect(first).toHaveLength(5);
    expect(new Set(first.map(item => item.paragraphId)).size).toBe(5);
    expect(first[1]?.text).toBe("- 第二段\n继续。");
    expect(first[4]?.classification).toBe("cta");
  });

  it("builds at least four shots while keeping every body paragraph mapped in both directions", () => {
    const paragraphs = canonicalizePublishingVideoParagraphs("一。\n\n二。\n\n三。");
    const preview = buildPublishingVideoPreview({
      paragraphs,
      rewrites: paragraphs.map((paragraph, index) => ({
        paragraphId: paragraph.paragraphId,
        scriptText: `改写后的第${index + 1}段画外音。`,
        visualTreatment: `用第${index + 1}个动作表达这一段。`,
      })),
    });

    expect(preview.shots).toHaveLength(4);
    for (const paragraph of paragraphs) {
      const segment = preview.segments.find(
        item => item.sourceParagraphId === paragraph.paragraphId
      );
      expect(segment?.shotIds.length).toBeGreaterThan(0);
      expect(
        preview.shots.some(shot =>
          shot.sourceParagraphIds.includes(paragraph.paragraphId)
        )
      ).toBe(true);
    }
    expect(validatePublishingVideoPreview(preview)).toEqual([]);
  });

  it("keeps narration and sound in dedicated shot fields instead of the video requirement", () => {
    const paragraphs = canonicalizePublishingVideoParagraphs("这是文字稿原文。");
    const preview = buildPublishingVideoPreview({
      paragraphs,
      rewrites: [
        {
          paragraphId: paragraphs[0]!.paragraphId,
          scriptText: "人物把信纸放回桌面。",
          visualTreatment: "用一次克制的手部动作完成情绪转折。",
          shots: [
            {
              subject: "桌边的人物",
              action: "把信纸放回桌面",
              imageRequirement: "冷蓝屏幕光照在泛黄旧纸上",
              videoRequirement: "手指松开信纸，相机缓慢后撤并停住",
              soundRequirement: "纸张摩擦声，远处低频环境音",
            },
            {
              subject: "桌面的信纸",
              action: "纸角轻轻回弹",
              imageRequirement: "纸张纤维近景",
              videoRequirement: "纸角回弹后停在画面右下角",
              soundRequirement: "轻微纸张回弹声",
            },
          ],
        },
      ],
    });

    expect(preview.shots[0]).toMatchObject({
      voiceText: "这是文字稿原文。",
      soundRequirement: "纸张摩擦声，远处低频环境音",
      videoRequirement: "手指松开信纸，相机缓慢后撤并停住",
    });
    expect(preview.shots[1]).toMatchObject({
      voiceText: "",
      soundRequirement: "轻微纸张回弹声",
    });
  });

  it("requires six body paragraphs to produce at least six script-bearing shots", () => {
    const paragraphs = canonicalizePublishingVideoParagraphs(
      Array.from({ length: 6 }, (_, index) => `第${index + 1}段正文。`).join(
        "\n\n"
      )
    );
    const preview = buildPublishingVideoPreview({
      paragraphs,
      rewrites: paragraphs.map((paragraph, index) => ({
        paragraphId: paragraph.paragraphId,
        scriptText: `镜头中的叙述推进到第${index + 1}层。`,
        visualTreatment: `画面推进第${index + 1}次。`,
      })),
    });

    expect(preview.segments).toHaveLength(6);
    expect(preview.shots).toHaveLength(6);
    expect(validatePublishingVideoPreview(preview)).toEqual([]);
  });

  it("rejects copy-equal scripts, missing mappings, and unbounded shot output", () => {
    const paragraphs = canonicalizePublishingVideoParagraphs("原文第一段。\n\n原文第二段。");
    const preview = buildPublishingVideoPreview({
      paragraphs,
      rewrites: paragraphs.map(paragraph => ({
        paragraphId: paragraph.paragraphId,
        scriptText: `重新表达：${paragraph.text}`,
        visualTreatment: "使用可表演动作。",
      })),
    });
    preview.segments[0]!.scriptText = paragraphs[0]!.text;
    preview.segments[1]!.shotIds = [];
    preview.shots.push(
      ...Array.from({ length: 30 }, (_, index) => ({
        ...preview.shots[0]!,
        draftShotId: `overflow-${index}`,
      }))
    );

    expect(validatePublishingVideoPreview(preview).map(item => item.code)).toEqual(
      expect.arrayContaining([
        "script_copies_source",
        "segment_without_shot",
        "too_many_shots",
      ])
    );
  });

  it("classifies only unchanged one-to-one lineage as safe stable-id reuse", () => {
    const previous: PublishingVideoStoryboardShot[] = [
      {
        draftShotId: "old-a",
        stableShotId: "publishing-v1-a",
        segmentIds: ["segment-a"],
        sourceParagraphIds: ["paragraph-a"],
        scriptText: "旧剧本 A",
        subject: "人物 A",
        action: "抬头",
        imageRequirement: "旧画面 A",
        videoRequirement: "静止",
      },
      {
        draftShotId: "old-b",
        stableShotId: "publishing-v1-b",
        segmentIds: ["segment-b"],
        sourceParagraphIds: ["paragraph-b"],
        scriptText: "旧剧本 B",
        subject: "人物 B",
        action: "转身",
        imageRequirement: "旧画面 B",
        videoRequirement: "平移",
      },
    ];
    const next = previous.map(shot => ({ ...shot, stableShotId: undefined }));
    next[1] = { ...next[1]!, sourceParagraphIds: ["paragraph-b", "paragraph-c"] };

    const impact = classifyPublishingVideoImpact({
      previousShots: previous,
      nextShots: next,
      currentFormalShots: previous,
      confirmedBaselineByStableShotId: {
        "publishing-v1-a": previous[0]!,
        "publishing-v1-b": previous[1]!,
      },
    });

    expect(impact.items[0]).toMatchObject({
      kind: "retain",
      previousStableShotIds: ["publishing-v1-a"],
      proposedStableShotId: "publishing-v1-a",
      requiresResolution: false,
    });
    expect(impact.items[1]).toMatchObject({
      kind: "merge",
      requiresResolution: true,
    });
  });

  it("treats a field changed after confirmation as a manual conflict", () => {
    const baseline: PublishingVideoStoryboardShot = {
      draftShotId: "shot-a",
      stableShotId: "publishing-v1-a",
      segmentIds: ["segment-a"],
      sourceParagraphIds: ["paragraph-a"],
      scriptText: "已确认剧本",
      subject: "人物",
      action: "抬头",
      imageRequirement: "蓝色房间",
      videoRequirement: "缓慢推进",
    };
    const impact = classifyPublishingVideoImpact({
      previousShots: [baseline],
      nextShots: [{ ...baseline, stableShotId: undefined, scriptText: "新剧本" }],
      currentFormalShots: [{ ...baseline, scriptText: "用户手改剧本" }],
      confirmedBaselineByStableShotId: { "publishing-v1-a": baseline },
    });

    expect(impact.items[0]).toMatchObject({
      kind: "manual_field_conflict",
      requiresResolution: true,
      changedFields: ["scriptText"],
    });
  });
});
