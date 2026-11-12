/**
 * 「后半段森林的颜色压暗一点点（其他的不要变），主要突出纸飞机的亮度」：视频里按时段、按对象的免费亮度微调。
 * 目前支持的对象：森林（绿色植被）。只降亮度，色相和饱和度不变；不是这种句子就返回 null，交给原来的流程。
 */

export type RegionalWindowIntent = "second-half" | "first-half" | "whole" | { startSec: number; endSec: number };

export type RegionalGradeIntent =
  | { kind: "video-region"; subject: "forest"; window: RegionalWindowIntent; deltaL: number; emphasizePlane: boolean; takeId?: number; shotNo?: number }
  | { kind: "ask"; question: string };

const FOREST = /森林|树林|树木|树丛|树冠|植被|林子|树/u;
const DARKEN = /压暗|调暗|变暗|暗一点|暗一些|暗些|暗点|暗下来|降低亮度|亮度降|亮度低一点|压一压/u;
const OTHER_CHANGE = /生成|重新|重做|换成|加上|增加|添加|删|去掉|改成|改为|种类|品种|形状|颜色换|色相改|饱和度(?:提高|降低|加|减)/u;
const DIGIT = "零一二三四五六七八九";

function chineseNumber(raw: string): number {
  if (/^\d+$/.test(raw)) return Number(raw);
  const parts = raw.replace(/两/g, "二").split("十");
  if (parts.length === 2) return (parts[0] ? DIGIT.indexOf(parts[0]) : 1) * 10 + (parts[1] ? DIGIT.indexOf(parts[1]) : 0);
  return DIGIT.indexOf(raw);
}

function parseWindow(text: string): RegionalWindowIntent | null {
  const range = text.match(/(?:第\s*)?(\d+(?:\.\d+)?)\s*(?:秒|s)?\s*(?:到|至|-|~|—)\s*(?:第\s*)?(\d+(?:\.\d+)?)\s*(?:秒|s)/u);
  if (range) {
    const startSec = Number(range[1]), endSec = Number(range[2]);
    return endSec > startSec ? { startSec, endSec } : null;
  }
  const from = text.match(/(?:从\s*)?(?:第\s*)?(\d+(?:\.\d+)?)\s*秒(?:以后|之后|后|开始|起)/u);
  if (from) return { startSec: Number(from[1]), endSec: 1e6 };
  if (/后半段|后半部分|后一半|后半截|下半段|后半程/u.test(text)) return "second-half";
  if (/前半段|前半部分|前一半|前半截|上半段|前半程/u.test(text)) return "first-half";
  return null;
}

export function parseRegionalGradeIntent(text: string): RegionalGradeIntent | null {
  const value = text.trim();
  if (!value || value.length > 200) return null;
  // 「其他的不要变」「颜色不要变」是保护语，不算要改别的。
  const stripped = value.replace(/[（(]?\s*其他(?:的|地方|部分)?\s*(?:都)?\s*(?:不要|别|不)\s*(?:变|动|改)\s*[）)]?/gu, "")
    .replace(/(?:色相|饱和度|颜色)(?:和(?:色相|饱和度|颜色))?\s*(?:不要|别|不)\s*(?:变|动|改)/gu, "");
  if (!DARKEN.test(stripped) || !FOREST.test(stripped)) return null;
  if (OTHER_CHANGE.test(stripped) || /[吗？?]\s*$/u.test(stripped)) return null;
  const window = parseWindow(stripped);
  const deltaL = /一点点|稍微|稍稍|微微|略微|轻微|一丢丢/u.test(stripped) ? 5 : /明显|多一些|多一点|更暗/u.test(stripped) ? 8 : /一点|一些|些/u.test(stripped) ? 6 : 5;
  const take = value.match(/(?:视频\s*)?take\s*#?\s*(\d+)/iu);
  const shot = value.match(/第\s*([\d零一二三四五六七八九十两]+)\s*(?:个)?镜/u);
  return {
    kind: "video-region", subject: "forest", window: window ?? "whole", deltaL,
    emphasizePlane: /纸飞机|飞机/u.test(value),
    ...(take ? { takeId: Number(take[1]) } : {}),
    ...(shot ? { shotNo: chineseNumber(shot[1]) } : {}),
  };
}

export type RegionalGradeReplyInput = {
  takeId: number; parentTakeId: number; shotNo: number | null; replayed: boolean;
  metrics: {
    windowStartSec: number; windowEndSec: number; subjectStartSec: number; rampSec: number; copiedFrames: number; totalFrames: number; copiedFramesIdentical: boolean;
    forestLBefore: number; forestLAfter: number; forestHslSBefore: number; forestHslSAfter: number; highlightLBefore: number; highlightLAfter: number;
    clipWhiteBefore: number; clipWhiteAfter: number;
  };
};

export function regionalGradeReply(result: RegionalGradeReplyInput, emphasizePlane: boolean): string {
  const m = result.metrics;
  const shot = result.shotNo ? `第 ${result.shotNo} 镜` : "这一镜";
  return [
    `已在本机生成视频 Take ${result.takeId}（基于 Take ${result.parentTakeId}，0 算力，原视频不变）${result.replayed ? "（同一请求，沿用已生成的结果）" : ""}：`,
    `· 调整时段 ${m.windowStartSec.toFixed(1)}–${m.windowEndSec.toFixed(1)} 秒（森林从约 ${m.subjectStartSec.toFixed(1)} 秒出现，和“后半段”取交集；入口 ${m.rampSec} 秒渐变）。`,
    `· 森林亮度 L ${m.forestLBefore} → ${m.forestLAfter}，色相和饱和度不变（HSL S ${m.forestHslSBefore} → ${m.forestHslSAfter}）。`,
    `· ${emphasizePlane ? "纸飞机等白色高光" : "白色高光"}没有压暗：L ${m.highlightLBefore} → ${m.highlightLAfter}；夹白 ${m.clipWhiteBefore}% → ${m.clipWhiteAfter}%。`,
    `· 前 ${m.copiedFrames}/${m.totalFrames} 帧原样拷贝，逐帧校验${m.copiedFramesIdentical ? "一致" : "不一致"}。`,
    `满意的话回复「采用视频 Take ${result.takeId}」放入${shot}；想再暗一点可以说“后半段森林再压暗一点”。`,
  ].join("\n");
}
