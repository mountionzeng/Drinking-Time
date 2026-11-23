/** Closed editing operations. Never interpret a user's text as a shell/filter expression. */
export type LocalPictureEdit =
  | { kind: "light"; amount: number; label: string }
  | { kind: "hold"; start: number; end: number; area: string; label: string };

export const localNotePrefix = "local-video-note:";
export const localReplyPrefix = "local-video-edit:";
// Keep punctuation separating numbers: “1.2 秒” and “12 秒” must select different edits.
export const feedbackKey = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(
      /[\s。，、！!？?,.：:]+/g,
      (part: string, offset: number, whole: string) =>
        /\d/.test(whole[offset - 1] ?? "") &&
        /\d/.test(whole[offset + part.length] ?? "")
          ? part
          : ""
    );
const directionText = (text: string) =>
  text.trim().replace(/^第\s*\d+\s*镜(?:头)?[，,:：\s]+/, "");
export function pictureEdit(text: string): LocalPictureEdit | undefined {
  const s = directionText(text)
    .replace(/^(?:请|帮我|麻烦)?(?:只)?(?:把|让)?/, "")
    .replace(/[。！!\s]+$/, "");
  const light =
    /^(?:整段(?:视频|画面)?|整个画面|全片画面|视频画面|画面)(?:整体)?(?:稍微|稍稍|稍|再|只)?(?:调|提|变)?(亮|暗)(?:一点点|一点|一些|些)$/.exec(
      s
    );
  if (light)
    return {
      kind: "light",
      amount: light[1] === "亮" ? 0.025 : -0.025,
      label: "把这段视频的画面稍微调" + light[1],
    };
  const hold =
    /^(?:从)?第?(\d+(?:\.\d+)?)秒?(?:到|至|[-–])第?(\d+(?:\.\d+)?)秒[，,\s]*(?:固定|定格|锁住)(?:画面)?(左上四分之一|右上四分之一|左下四分之一|右下四分之一|全画面|整个画面)$/.exec(
      s
    );
  if (hold)
    return {
      kind: "hold",
      start: Number(hold[1]),
      end: Number(hold[2]),
      area: hold[3],
      label: hold[1] + " 到 " + hold[2] + " 秒固定" + hold[3],
    };
}

/** Compare fully understood edit lists. Unparsed qualifiers make the whole list ineligible. */
function editList(text: string) {
  const actions = new Set<string>();
  const subject = "([\\p{Script=Han}]{1,12})";
  const remove = new RegExp("^(?:去掉|移除|删掉|不要有)" + subject + "$", "u");
  const edges = new RegExp(
    "^" +
      subject +
      "(?:的)?边缘(?:也)?(?:需要你|需要|请)?(?:处理一下|修一下|修顺|修好)$",
    "u"
  );
  const smooth = new RegExp(
    "^(?:修顺|修好|处理一下)" + subject + "的边缘$",
    "u"
  );
  const still = new RegExp("^" + subject + "(?:不要动|别动|固定不动)$", "u");
  const keep =
    /^(?:保留|沿用|保持|很喜欢)(?:之前|原来|原有)?(?:的)?(.+?)(?:的)?流动(?:的感觉)?$/;
  for (const part of text
    .split(/[，,。；;！!]+/)
    .map(feedbackKey)
    .filter(Boolean)) {
    if (/^(?:我觉得)?(?:这一块|这部分|这个)(?:很扯|不太好|不满意)$/.test(part))
      continue;
    const clause = part.replace(
      /^(?:另外)?(?:但是)?(?:我)?(?:只是)?(?:希望)?/,
      ""
    );
    let match = remove.exec(clause);
    if (match) {
      actions.add("remove:" + match[1]);
      continue;
    }
    match = edges.exec(clause) ?? smooth.exec(clause);
    if (match) {
      actions.add("edges:" + match[1].replace(/的$/, ""));
      continue;
    }
    match = still.exec(clause);
    if (match) {
      actions.add("still:" + match[1]);
      continue;
    }
    match = keep.exec(clause);
    if (match) {
      for (const name of match[1].split(/和|与|、/)) {
        if (!/^[\p{Script=Han}]{1,10}$/u.test(name)) return;
        actions.add(
          "motion:" +
            (name === "云彩" || name === "云层"
              ? "云"
              : name === "河水"
                ? "水"
                : name)
        );
      }
      continue;
    }
    return;
  }
  if (actions.size) return JSON.stringify([...actions].sort());
}

/** Conservative equivalence for a single complaint. Never discard additional directions. */
export function sameVideoDirection(a: string, b: string) {
  a = directionText(a);
  b = directionText(b);
  if (feedbackKey(a) === feedbackKey(b)) return true;
  const list = editList(a);
  if (list && list === editList(b)) return true;
  const bank = (text: string) => {
    const parts = text
      .split(/[，,。！!？?；;]+/)
      .map(feedbackKey)
      .filter(Boolean);
    const movement =
      /^(?:水边|水的边缘|河岸|两岸|岸线)(?:的位置)?(?:还(?:是|在)|一直在|别再|不要再?|别|不应(?:该)?|正在|在|会)?(?:跟着(?:水面|水|它)?(?:一起)?)?(?:晃动?|抖动?|震动|振动)(?:了)?$/;
    const stop =
      /^(?:请|希望)?(?:让|把)?(?:水边|水的边缘|河岸|两岸|岸线)(?:的位置)?(?:保持稳定|稳住|固定不动|不要(?:再)?(?:晃动?|抖动?|震动)|别动)$/;
    const complaint = (part: string) => movement.test(part) || stop.test(part);
    const context =
      /^(?:(?:这(?:个|种))?(?:河?水|水面)(?:的)?(?:变化|运动|流动)(?:特别|很|太)?(?:不正常|奇怪)|(?:你)?(?:应该|可以)?先(?:看一下|看看)(?:河?水|水面)(?:应该)?怎么(?:变化|运动|流动)|这(?:是)?不对的)$/;
    return (
      parts.some(complaint) && parts.every(p => complaint(p) || context.test(p))
    );
  };
  return bank(a) && bank(b);
}
type ArchiveRow = {
  id: string;
  text: string;
  who: string;
  selectionQuote?: {
    storyId?: number | null;
    stableShotId?: string | null;
    videoTakeId?: number | null;
  };
};
const reviewNumber = (text: string) =>
  Number(/^回看候选视频\s*Take\s*#(\d+)\b/i.exec(text)?.[1]);
/** Older locally imported edits recorded the preceding preview and a linked feedback/result/review quartet. */
export function archivedPictureEdit(
  rows: ArchiveRow[],
  storyId: number,
  stableShotId: string,
  source: number,
  instruction: string
) {
  const scoped = (row?: ArchiveRow) =>
    row?.selectionQuote?.storyId === storyId &&
    row.selectionQuote.stableShotId === stableShotId;
  const matches = new Set<number>();
  for (let i = 2; i + 3 < rows.length; i++) {
    const [base, preview, note, result, review, receipt] = rows.slice(
      i - 2,
      i + 4
    );
    if (
      ![base, preview, note, result, review, receipt].every(scoped) ||
      typeof note.id !== "string" ||
      !note.id.endsWith("-feedback") ||
      typeof note.text !== "string" ||
      note.who !== "u" ||
      base.who !== "u" ||
      preview.who !== "s" ||
      preview.id !== "video-cues:" + base.id ||
      result.who !== "s" ||
      review.who !== "u" ||
      receipt.who !== "s" ||
      !sameVideoDirection(note.text, instruction)
    )
      continue;
    const family = note.id.slice(0, -9),
      target = reviewNumber(review.text);
    if (
      target &&
      (source === reviewNumber(base.text) || source === target) &&
      result.id === family + "-result" &&
      review.id === family + "-review" &&
      receipt.id === "video-cues:" + review.id
    )
      matches.add(target);
  }
  return matches.size === 1 ? [...matches][0] : undefined;
}
export function looksLikeVideoFeedback(text: string) {
  if (
    /生成|重做|重新渲染|改图|图片|关键帧|剪辑线|下一镜|为什么|多少钱|是否|[?？]/.test(
      text
    )
  )
    return false;
  return (
    !!pictureEdit(text) ||
    (/(?:野餐垫|河岸|岸线|水的边缘|水边|树(?:形|的位置)?\s*(?:保持|不要动)|电脑的边缘)/.test(
      text
    ) &&
      /(?:不要|不对|不正常|去掉|处理|固定|晃|抖|震动|振动)/.test(text))
  );
}
export function startingLocalFeedback(text: string) {
  const plan = pictureEdit(text);
  return plan
    ? "正在读取原片，准备" + plan.label + "。"
    : "正在核对这版视频，查找这个镜头已有的修改。";
}

/** Apply a proven whole-shot repair for only the requested seconds, retaining the rest of the source. */
export function scopedRepair(text: string) {
  const range =
    /^(?:只)?(?:从|在)?第?(\d+(?:\.\d+)?)秒?(?:到|至|[-–])第?(\d+(?:\.\d+)?)秒[，,：:\s]+(.+)$/.exec(
      directionText(text)
    );
  return range
    ? { start: Number(range[1]), end: Number(range[2]), direction: range[3] }
    : undefined;
}
