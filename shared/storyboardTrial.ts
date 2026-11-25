import { readBookShotChapter } from "./bookShotDocument";
import type { ConversionDraft } from "./bookWorkflow";

const digit = "零一二三四五六七八九";
// Quoted copy is manuscript content, including when it contains words such as “第九镜”.
export const shotOrdinal = "(?:第?\\s*[0-9零一二三四五六七八九十]+\\s*(?:个)?镜(?:头)?|最后(?:的)?一(?:个)?镜(?:头)?|末镜)";
export function trialInstruction(text:string) {
  return text.replace(/“[^”]*”|「[^」]*」|"[^"\n]*"/gu,"「…」");
}
export function pictureOnlyQuestion(text: string) {
  const command = new RegExp("^(?:请|帮我|我想|我就|先|\\s)*(?:只|单独)(?:想)?(?:换|改|调整)(?:一下)?\\s*("+shotOrdinal+")\\s*的?画面(?:[，,、。\\s]*(?:旁白|台词|声音|音效|字幕|其他|其余|别的)(?:原句)?(?:都)?(?:照旧|不变|不动|保留|不改))*[。！!\\s]*$","u");
  return command.exec(text.trim())?.[1];
}
export function pictureFollowup(original:string, reply:string) {
  const ordinal=pictureOnlyQuestion(original);
  if (!ordinal) return;
  const literal=/^(?:(?:就|画面|用|写|换成|改成|写成|这句|这段)[：:\s]*)*[“「]([^”」\n]+)[”」][。！!\s]*$/u.exec(reply.trim());
  if (literal) return ordinal+"的画面换成“"+literal[1]+"”，旁白照旧。";
  const text = reply.trim();
  if (!text || /^(?:取消|算了|不用|先不|先别|比较|对比|换个话题|第\s*[0-9零一二三四五六七八九十]+\s*镜)|^(?:不要|好|好的|可以|可以了|谢谢|OK|嗯)[。！!\s]*$|[？?]$/iu.test(text)) return;
  if (comparisonIntent(text) || requestsWrittenStoryboard(text) || /(?:生成|制作|导出|渲染).{0,5}(?:视频|分镜|图片|音乐)|(?:串|连|整理).{0,10}(?:全片|整片)/u.test(text)) return;
  return original+"\n作者补充的画面要求："+text;
}
function shotNumber(raw: string) {
  if (/^\d+$/.test(raw)) return Number(raw);
  const [tens, ones] = raw.split("十");
  return ones === undefined
    ? digit.indexOf(tens)
    : (tens ? digit.indexOf(tens) : 1) * 10 + (ones ? digit.indexOf(ones) : 0);
}
export function requestedShots(message: string, total: number) {
  message=trialInstruction(message).replace(/最后(?:的)?一(?:个)?镜(?:头)?|末镜/gu, "第"+total+"镜");
  const result = new Set<number>();
  const number = "[0-9零一二三四五六七八九十]+";
  for (const m of message.matchAll(
    new RegExp(
      "第?\\s*(" +
        number +
        ")\\s*(?:镜\\s*)?(?:[—–至到-]\\s*第?\\s*(" +
        number +
        ")\\s*)?镜(?!头语言)",
      "gu"
    )
  )) {
    const start = shotNumber(m[1]),
      end = m[2] ? shotNumber(m[2]) : start;
    if (start < 1 || end < start || end > total)
      throw new Error("镜号超出当前稿件范围，请核对镜号。");
    for (let i = start; i <= end; i++) result.add(i);
  }
  if (/片尾|结尾/u.test(message) && !result.size && total)
    result.add(total);
  return [...result];
}
export function trialChatAction(
  message: string,
  selected: boolean
): "read" | "write" | undefined {
  const text = message.trim();
  if (
    /^(?:只聊|先讨论|先不改|先别改)|^(?:我)?(?:还是|更|比较)?喜欢[^，。！？]*[。！!\s]*$|[？?]$/.test(
      text
    ) ||
    /(?:渲染|生成|制作|做成|导出)(?:一(?:个|张|条|段))?(?:视频|短片|图片|图像|配音|音频|音乐)/u.test(
      text
    )
  )
    return;
  const editing =
    /(?:试改|试写|试排|改成|改为|改一下|改一|改第|重写|换成|换个|调整|提前|延后|压低|放慢|再慢|更轻|停留|推近|淡入|淡出|先看[见到]|先听|补上|补一|再试|换到|多留|短一点|留白|回到|写一|整理成|生成)/u;
  const scope =
    /(?:第?\s*[0-9零一二三四五六七八九十]+\s*镜|最后(?:的)?一(?:个)?镜|分镜|旁白|字幕|音效|试读稿|合稿|结尾|片尾|全片|整片|底稿|这版)/u;
  if (
    (selected || scope.test(text)) &&
    /(?:串|连|合|汇总|整理).{0,18}(?:全片|整片|试读稿|起来(?:看|读))|(?:读|看)(?:看|一下|一遍)?(?:这版|当前)?(?:全片|整片|试读稿)/u.test(
      text
    ) &&
    !editing.test(text.replace(/整理成/g, ""))
  )
    return "read";
  if (
    justNamesTrial(text) ||
    ((selected || scope.test(text)) &&
      (namedTrialLabel(text) || editing.test(text) || /只(?:想)?换|单独换/u.test(text)))
  )
    return "write";
  if (
    selected &&
    /(?:再|改|试试|写成|收一点|更|换|缩短|加长|删掉|去掉|移到|加上|延长)/u.test(
      text
    )
  )
    return "write";
}
export function trialChoice(message: string, drafts: ConversionDraft[]) {
  const m =
    /^(?:(?:请|先|想|我们|咱们|给我|我想|试试|试|看看|看|打开|用|选|切到|切换到|结尾|版本|方案|第|\s)+)([AB])(?:\s*版|\s*方案|\s*结尾)?(?:[，,。！!\s]*(?:先|把|保留|留着|底稿|原稿|原版|不要动|不动|一下|吧|其他|不变|别动|别改))*[。！!\s]*$/iu.exec(
      message.trim()
    );
  if (!m) return;
  const re = new RegExp(
    "(?:结尾|版本|方案)\\s*" + m[1] + "(?:\\s|[｜·]|$)",
    "iu"
  );
  const matches = drafts.filter(
    d => d.status === "review" && d.trial && re.test(d.trial.label)
  );
  if (matches.length === 1) return matches[0];
}

export function comparisonIntent(text: string) {
  text = trialInstruction(text);
  if (/刚才改了什么|这(?:一)?版改了哪些|这次改了什么/u.test(text)) return "parent";
  if (!/(?:比较|对比|区别|差别|不同|差在哪|哪里不一样|改了什么|改了哪些)/u.test(text)) return;
  if (/两(?:个|种|版|份)?(?:结尾|收尾)|[AB]\s*(?:版\s*)?[/／和与、跟]\s*[AB]/iu.test(text)) return "endings";
  if (/上(?:一)?[版稿]|上一份|来源稿|改前|修改前/u.test(text)) return "parent";
  if (/两(?:个|种|份)?(?:版|方案|试稿)|这两份/u.test(text)) return "pair";
}

export function comparisonPair(intent: NonNullable<ReturnType<typeof comparisonIntent>>, candidates: ConversionDraft[], current?: ConversionDraft) {
  const source = current?.trial;
  const parent = source && candidates.find(d => d.id === source.base &&
    (source.baseRevision === undefined || d.revision === source.baseRevision));
  if (intent === "parent" || (intent === "pair" && parent)) {
    return parent && current ? [parent, current] : [];
  }
  const a = trialChoice("看A", candidates);
  const b = trialChoice("看B", candidates);
  if (a && b && a.id !== b.id) return [a, b];
  return intent === "pair" && candidates.length === 2 ? candidates : [];
}
export function requestsWrittenStoryboard(text: string) {
  if (
    /^(?:如果|假如)|[？?]|(?:不要|先别|不必)(?:再)?(?:写|生成|做)/u.test(text)
  )
    return false;
  return /(?:写|生成|做|整理|串|连排|改编|出)(?:出|成|一份|一个|一版|一下|这份|全片|整片|完整的?|可编辑的?|的|\s)*(?:分镜(?:版|稿|脚本|文字)?|全片试读稿|十镜试读稿)/u.test(
    text
  );
}
export function readingComparison(
  left: ConversionDraft,
  right: ConversionDraft
) {
  const describe = (draft: ConversionDraft) =>
    draft.chapters?.flatMap((c, i) =>
      readBookShotChapter({ id: i + 1, blocks: c.blocks }).shots.map(s => ({
        title: s.title,
        notes: s.notes,
        voice: s.dialogueText,
        media: [
          ...s.images.map(im => im.url),
          ...s.audio.map(a => a.assetId),
        ].join("、"),
      }))
    ) ?? [];
  const a = describe(left),
    b = describe(right),
    lines: string[] = [];
  const leftLabel = left.trial?.label ?? left.request,
    rightLabel = right.trial?.label ?? right.request;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i],
      y = b[i];
    if (JSON.stringify(x) === JSON.stringify(y)) continue;
    lines.push(
      "第 " + String(i + 1).padStart(2, "0") + " 镜 · " + (y?.title ?? x.title)
    );
    for (const key of ["title", "notes", "voice", "media"] as const) {
      if (x?.[key] === y?.[key]) continue;
      const old = x?.[key]?.split("\n") ?? [],
        next = y?.[key]?.split("\n") ?? [];
      let first=0, endA=old.length, endB=next.length;
      while(first<endA && first<endB && old[first]===next[first]) first++;
      while(endA>first && endB>first && old[endA-1]===next[endB-1]) { endA--; endB--; }
      lines.push(
        "① " + (old.slice(first,endA).join("\n") || "未写此段"),
        "② " + (next.slice(first,endB).join("\n") || "未写此段")
      );
    }
  }
  return [
    "① " + leftLabel,
    "② " + rightLabel,
    lines.length ? lines.join("\n") : "两版逐镜内容相同。",
  ].join("\n\n");
}

/** An author can name a new branch in the same turn as the edit. */
export function namedTrialLabel(message: string) {
  const m =
    /(?:另存为|留为|记为|叫做?|命名为|作为|写一(?:个|版)|再试(?:一(?:个|版))?)\s*(?:(?:结尾|版本|方案)\s*([AB])|([AB])\s*版)(?:\s*[｜|·]\s*([^，。！\n]{1,40}))?/iu.exec(
      message
    );
  return (
    m &&
    "结尾 " + (m[1] ?? m[2]).toUpperCase() + (m[3] ? "｜" + m[3].trim() : "")
  );
}
export function justNamesTrial(message: string) {
  return /^(?:请|先|帮我|把|将|这版|这一版|当前版|当前试稿|分镜|\s)*(?:另存为|留为|记为|命名为|叫做?)\s*(?:(?:结尾|版本|方案)\s*[AB]|[AB]\s*版)(?:\s*[｜|·]\s*[^，。！\n]{1,40})?[。！!\s]*$/iu.test(
    message
  );
}
