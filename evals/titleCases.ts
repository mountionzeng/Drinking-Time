import { TEXT_TITLE_KINDS, type TextTitleKind } from "../shared/textTitle";
import type { PublishingPlatformId } from "../shared/publishingDraft";

export const TITLE_KINDS = TEXT_TITLE_KINDS;

export type TitleKind = TextTitleKind;

export type TitleEvalCase = {
  id: string;
  kind: TitleKind;
  platform?: PublishingPlatformId;
  sourceTexts: string[];
  oldTitle: string;
};

/**
 * Small, synthetic characterization set for the four title jobs.
 *
 * These cases preserve observed failure shapes without copying local user text.
 * They are intentionally not a benchmark or a claim about click-through rate.
 */
export const TITLE_CASES: readonly TitleEvalCase[] = [
  {
    id: "publishing-product-log",
    kind: "publishing",
    platform: "xiaohongshu",
    sourceTexts: ["辞职以后，我每天写产品日志，记录决定和犹豫。"],
    oldTitle: "关于独立做产品的一些想法",
  },
  {
    id: "publishing-night-train",
    kind: "publishing",
    platform: "wechat_moments",
    sourceTexts: ["我在末班车上改完了第一版剧本，窗外一直在下雨。"],
    oldTitle: "一次很有意义的经历",
  },
  {
    id: "publishing-interview-notes",
    kind: "publishing",
    platform: "linkedin",
    sourceTexts: ["三次面试后，我把每次答不好的问题整理成了一页复盘。"],
    oldTitle: "我的求职感悟",
  },
  {
    id: "publishing-repaired-camera",
    kind: "publishing",
    platform: "douyin_tiktok",
    sourceTexts: ["旧相机修好后，我第一次拍到父亲做木工的手。"],
    oldTitle: "记录一下今天发生的事情",
  },
  {
    id: "publishing-fiction-rewrite",
    kind: "publishing",
    platform: "xiaohongshu",
    sourceTexts: ["我删掉英雄获胜的结尾，让他回到空无一人的站台。"],
    oldTitle: "关于创作的思考",
  },
  {
    id: "story-pottery-class",
    kind: "story",
    sourceTexts: ["第一次拉坯时，杯壁在手里塌了三次。"],
    oldTitle: "我想聊聊第一次学陶艺的经历",
  },
  {
    id: "story-rooftop-garden",
    kind: "story",
    sourceTexts: ["楼顶花园熬过了台风，薄荷只剩两片叶子。"],
    oldTitle: "关于楼顶花园的一些事情",
  },
  {
    id: "story-lost-map",
    kind: "story",
    sourceTexts: ["地图被雨泡烂后，两个人沿着河声往回走。"],
    oldTitle: "这是一个关于迷路的故事",
  },
  {
    id: "story-first-client",
    kind: "story",
    sourceTexts: ["第一个客户拒绝了方案，却留下了一句具体建议。"],
    oldTitle: "今天发生的事情",
  },
  {
    id: "story-grandmother-radio",
    kind: "story",
    sourceTexts: ["外婆每天午后打开那台只能收到一个频道的收音机。"],
    oldTitle: "我的故事",
  },
  {
    id: "version-second-angle",
    kind: "version",
    sourceTexts: ["第二版把重点从离职改成了每天记录产品决定。"],
    oldTitle: "V2",
  },
  {
    id: "version-audience-shift",
    kind: "version",
    sourceTexts: ["这一版写给刚开始独立创作的人。"],
    oldTitle: "V3",
  },
  {
    id: "version-quieter-ending",
    kind: "version",
    sourceTexts: ["新结尾删掉解释，只保留空站台。"],
    oldTitle: "V4",
  },
  {
    id: "version-evidence-first",
    kind: "version",
    sourceTexts: ["把面试复盘的具体问题移到了开头。"],
    oldTitle: "V5",
  },
  {
    id: "version-platform-purpose",
    kind: "version",
    sourceTexts: ["这一版用于向同行介绍木工影像项目。"],
    oldTitle: "V6",
  },
  {
    id: "card-broken-cup",
    kind: "card",
    sourceTexts: ["第一次拉坯时，杯壁在手里塌了三次，我才学会放松手腕。"],
    oldTitle: "第一次拉坯时杯壁在手里塌…",
  },
  {
    id: "card-interview-question",
    kind: "card",
    sourceTexts: ["面试官追问我为什么删掉已经上线的功能。"],
    oldTitle: "面试官追问我为什么删掉已经…",
  },
  {
    id: "card-radio-dial",
    kind: "card",
    sourceTexts: ["收音机旋钮松了，外婆用一根红线固定住刻度。"],
    oldTitle: "收音机旋钮松了外婆用一根红…",
  },
  {
    id: "card-station-ending",
    kind: "card",
    sourceTexts: ["英雄没有获胜，他回到空无一人的站台。"],
    oldTitle: "英雄没有获胜他回到空无一人…",
  },
  {
    id: "card-product-decision",
    kind: "card",
    sourceTexts: ["我把每次放弃功能的原因写进产品日志。"],
    oldTitle: "我把每次放弃功能的原因写进…",
  },
];
