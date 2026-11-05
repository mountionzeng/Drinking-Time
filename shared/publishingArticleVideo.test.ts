import { describe, expect, it } from "vitest";
import { imagePackParagraphs } from "./articleIllustrations";
import {
  buildPublishingArticleVideoPreview,
  publishingArticleVideoRows,
  articleVideoSupplementSchema,
} from "./publishingArticleVideo";
import {
  normalizePublishingVideoStoryboardAggregate,
  validatePublishingVideoPreview,
} from "./publishingVideoStoryboard";

const body = "开头。\n\n阿宁走进铺子。\n\n爷爷修好旧伞。\n\n雨停了。";
const paragraphs = imagePackParagraphs(body);

describe("article illustrations carried into video", () => {
  it('keeps marked dialogue exact even when the model rewrites it, with speaker surviving normalization',()=>{
    const rows=publishingArticleVideoRows({body:'镜头推近\n你好',illustrations:[],bookScenes:[{id:'a',text:'镜头推近\n你好',referenceImageIds:[],dialogueText:'你好'}]});
    const preview=buildPublishingArticleVideoPreview({rows,now:1,requirements:new Map([['a',{subject:'小雨',action:'抬头',imageRequirement:'原图',videoRequirement:'推近',soundRequirement:'雨声，无音乐',voiceText:'读出镜头推近',speaker:'小雨'}]])});
    expect(preview.shots[0]).toMatchObject({scriptText:'镜头推近\n你好',voiceText:'你好',speaker:'小雨'});
    expect(normalizePublishingVideoStoryboardAggregate({version:1,latestPreview:preview})?.latestPreview?.shots[0].speaker).toBe('小雨');
  });
  it('uses offsets for repeated words and does not duplicate dialogue for pictures at the same position',()=>{
    const rows=publishingArticleVideoRows({body:'你好\n你好',dialogueRanges:[{start:3,end:5}],illustrations:[{assetId:1,after:null},{assetId:2,after:null}]});
    expect(rows.map(r=>r.dialogueText)).toEqual(['你好','']);
    expect(buildPublishingArticleVideoPreview({rows,requirements:new Map(),now:1}).shots.map(s=>s.voiceText)).toEqual(['你好','']);
  });
  it("keeps multiple book references on one act through preview normalization without assigning a first frame", () => {
    const rows = publishingArticleVideoRows({body: "第一幕。\n第二幕。", illustrations: [], bookScenes: [
      {id: "book-scene-1", text: "第一幕。", referenceImageIds: [1, 2]},
      {id: "book-scene-2", text: "第二幕。", referenceImageIds: []},
    ]});
    const preview = buildPublishingArticleVideoPreview({rows, requirements: new Map(), now: 10});
    expect(preview.shots).toHaveLength(2);
    expect(preview.shots.map(shot => shot.referenceImageIds)).toEqual([[1, 2], []]);
    expect(preview.shots.every(shot => !shot.referenceImageId && !shot.continuityImageId)).toBe(true);
    const normalized = normalizePublishingVideoStoryboardAggregate({version: 1, latestPreview: preview});
    expect(normalized?.latestPreview?.shots.map(shot => shot.referenceImageIds)).toEqual([[1, 2], []]);
    expect(validatePublishingVideoPreview(preview)).toEqual([]);
  });
  it("inserts only the planned missing shots in place and keeps original narration and frames", () => {
    const rows = publishingArticleVideoRows({
      body,
      illustrations: [
        { assetId: 10, after: null },
        { assetId: 20, after: paragraphs[1].anchor },
      ],
    });
    const detail = {
      anchorRowId: rows[0].id,
      position: "after" as const,
      sourceRowId: rows[0].id,
      reason: "全景中看不清修伞动作",
      subject: "阿宁的手",
      action: "手指压住松动的木条",
      imageRequirement: "手部特写，沿用人物和旧木架",
      videoRequirement: "固定近景，手指将木条按回原位",
      soundRequirement: "木条摩擦",
    };
    const preview = buildPublishingArticleVideoPreview({
      rows,
      requirements: new Map(),
      supplements: [
        detail,
        {
          ...detail,
          anchorRowId: rows[1].id,
          position: "before",
          sourceRowId: rows[1].id,
          reason: "缺少对动作的反应",
          action: "爷爷点头",
        },
        detail,
        { ...detail, sourceRowId: "invented-row" },
      ],
      now: 2,
    });
    expect(
      preview.shots.map(shot => shot.referenceImageId ?? shot.continuityImageId)
    ).toEqual([10, 10, 20, 20]);
    expect(preview.shots.map(shot => shot.referenceImageId)).toEqual([
      10,
      undefined,
      undefined,
      20,
    ]);
    expect(
      preview.shots
        .map(shot => shot.voiceText)
        .filter(Boolean)
        .join("\n\n")
    ).toBe(body);
    expect(preview.shots[1]).toMatchObject({
      supplementReason: detail.reason,
      scriptText: detail.action,
      voiceText: "",
    });
    expect(preview.segments[0].shotIds).toContain(preview.shots[1].draftShotId);
    expect(validatePublishingVideoPreview(preview)).toEqual([]);
    const restored = normalizePublishingVideoStoryboardAggregate({
      version: 1,
      latestPreview: preview,
      operations: {},
    })!;
    expect(restored.latestPreview?.shots[1]).toMatchObject({
      continuityImageId: 10,
      supplementReason: detail.reason,
    });
  });

  it("pairs each image with all following text until the next image, in article order", () => {
    const rows = publishingArticleVideoRows({
      body,
      illustrations: [
        { assetId: 20, after: paragraphs[2].anchor },
        { assetId: 10, after: paragraphs[0].anchor },
      ],
    });
    expect(rows.map(row => [row.referenceImageId, row.text])).toEqual([
      [undefined, "开头。"],
      [10, "阿宁走进铺子。\n\n爷爷修好旧伞。"],
      [20, "雨停了。"],
    ]);
    expect(rows.map(row => row.voiceText).join("\n\n")).toBe(body);
  });

  it("keeps supplement identity stable when another gap is inserted ahead of it", () => {
    const rows = publishingArticleVideoRows({ body, illustrations: [{ assetId: 10, after: null }] });
    const detail = {
      anchorRowId: rows[0].id, sourceRowId: rows[0].id, position: "after" as const,
      reason: "看清修补动作", subject: "阿宁", action: "钉好木条",
      imageRequirement: "木条和双手特写", videoRequirement: "固定镜头，敲下钉子", soundRequirement: "敲击声",
    };
    const preview = (supplements: typeof detail[]) => buildPublishingArticleVideoPreview({ rows, requirements: new Map(), supplements, now: 1 });
    const first = preview([detail]);
    const reordered = preview([{ ...detail, reason: "先看见刻痕", action: "指尖拂过刻痕" }, detail]);
    expect(reordered.shots[2].draftShotId).toBe(first.shots[1].draftShotId);
    expect(reordered.shots[1].draftShotId).not.toBe(first.shots[1].draftShotId);
    expect(preview([{ ...detail, imageRequirement: "修好后的木架全景" }]).shots[1].draftShotId).not.toBe(first.shots[1].draftShotId);
  });

  it("keeps every image at a shared position and at the end, without repeating narration", () => {
    const rows = publishingArticleVideoRows({
      body,
      illustrations: [
        { assetId: 1, after: null },
        { assetId: 2, after: null },
        { assetId: 3, after: paragraphs[3].anchor },
      ],
    });
    expect(rows.map(row => row.referenceImageId)).toEqual([1, 2, 3]);
    expect(rows.map(row => row.voiceText)).toEqual([body, "", ""]);
    const preview = buildPublishingArticleVideoPreview({
      rows,
      requirements: new Map(),
      now: 1,
    });
    expect(validatePublishingVideoPreview(preview)).toEqual([]);
    expect(preview.shots.map(shot => shot.referenceImageId)).toEqual([1, 2, 3]);
  });

  it("keeps unillustrated text and does not manufacture filler shots or rewrite it", () => {
    const rows = publishingArticleVideoRows({ body, illustrations: [] });
    const preview = buildPublishingArticleVideoPreview({
      rows,
      requirements: new Map(),
      now: 1,
    });
    expect(preview.shots).toHaveLength(1);
    expect(preview.shots[0].scriptText).toBe(body);
    expect(preview.shots[0].voiceText).toBe(body);
    expect(validatePublishingVideoPreview(preview)).toEqual([]);
  });

  it("rejects changed anchors and duplicate selections instead of silently losing images", () => {
    expect(() =>
      publishingArticleVideoRows({
        body: "已改动",
        illustrations: [{ assetId: 1, after: paragraphs[0].anchor }],
      })
    ).toThrow("重新定位");
    expect(() =>
      publishingArticleVideoRows({
        body,
        illustrations: [
          { assetId: 1, after: null },
          { assetId: 1, after: null },
        ],
      })
    ).toThrow("重复");
  });

  it("round-trips article mode and image references through persisted preview normalization", () => {
    const preview = buildPublishingArticleVideoPreview({
      rows: publishingArticleVideoRows({
        body,
        illustrations: [{ assetId: 8, after: null }],
      }),
      requirements: new Map(),
      now: 1,
    });
    const restored = normalizePublishingVideoStoryboardAggregate({
      version: 1,
      latestPreview: preview,
      operations: {},
    })!;
    expect(restored.latestPreview?.sourceMode).toBe("article");
    expect(restored.latestPreview?.shots[0].referenceImageId).toBe(8);
    expect(validatePublishingVideoPreview(restored.latestPreview!)).toEqual([]);
  });
});

 it("retains confirmed adapted narration and timing in supplemental shots without replacing source prose", () => {
   const rows = publishingArticleVideoRows({body:"原始故事。",illustrations:[]});
   const supplement=articleVideoSupplementSchema.parse({anchorRowId:rows[0].id,sourceRowId:rows[0].id,position:"after",reason:"结尾",subject:"旧伞",action:"收起旧伞",imageRequirement:"伞",videoRequirement:"缓缓推近",voiceText:"旧物，陪我们走过时光。",durationSec:6});
   const preview=buildPublishingArticleVideoPreview({rows,requirements:new Map(),supplements:[supplement],now:3});
   expect(preview.shots[0].scriptText).toBe("原始故事。");
   expect(preview.shots[1]).toMatchObject({voiceText:"旧物，陪我们走过时光。",durationSec:6});
   const aggregate=normalizePublishingVideoStoryboardAggregate({version:1,latestPreview:preview,operations:{}});
   expect(aggregate?.latestPreview?.shots[1].durationSec).toBe(6);
 });
