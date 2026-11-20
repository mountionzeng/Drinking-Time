import { createChatImageEditPlan, imageEditPlanQuote, keyframeBoardImageIds } from "@shared/chatImageEditPlan";
import type { ChatImageRef } from "@shared/chatImageRefs";
import { formatComputeQuote } from "@shared/computeMoney";
import { inlineChatParts, inlineImageToken } from "@shared/inlineChatImages";
import type { SelectionContext } from "@shared/selectionContext";
import type { ChatMessage } from "./types";

const digit = (s: string) => Number(s) || "零一二三四五六七八九".indexOf(s.replace("两", "二"));
const ordinal = "[1-9一二三四五六七八九两]";
const pair = new RegExp("第?(" + ordinal + ")\\s*[/／]\\s*第?(" + ordinal + ")张(截图|图|照片)", "g");
const mentions = new RegExp("(?:第(" + ordinal + ")张(?:截图|图|照片)?|(?:截图|图)\\s*(" + ordinal + "))", "g");
const referenceNumbers = (text: string) => [...new Set(Array.from(text.matchAll(mentions), m => digit(m[1] || m[2])))];

export function shotKeyframeBeats(input: string): string[] | null {
  const text = input.replace(/\[\[ref:[^\]]+\]\]/g, "").trim();
  if (!text || /(?:抽取|截取|提取|删除|回看|查看|恢复|不用|不要|别|先不|暂不).{0,7}(?:关键帧|分镜图|参考帧)|^(?:取消|只保存|怎么|为什么|如何)/.test(text)) return null;
  const explicitlyStill = /(?:生成|出|画|做|看|给我).{0,10}(?:关键帧|分镜图)/.test(text);
  const staged = /(?:先|一开始|开场).{0,12}(?:特写|近景|远景|镜头|拍|看见|展示|看到|出现|对准)/s.test(text) && /然后|接着|随后|最后|再(?:看|拍|展示|切|推)/.test(text);
  if ((!explicitlyStill && !staged) || (!explicitlyStill && /(?:生成|提交|渲染|制作).{0,5}视频/.test(text))) return null;
  const expanded = text.replace(pair, "第$1张$3、再展示第$2张$3");
  const beats = expanded.split(/(?:然后|接着|随后|最后|再(?=展示|切到|拍摄|推进|推近))|[。；;\n]|[，,、]\s*(?=(?:咱们的|我们的|另一个|另一只|第[一二三四五六七八九1-9]+张截图))/)
    .map(s => s.replace(/^[，,、\s]+|[，,、\s。]+$/g, "").trim())
    .filter(s => s && !/^(?:请|先|再)?(?:给我|帮我)?(?:生成|出|做|画|确认|看)[^，,。]{0,12}(?:关键帧|分镜图)[吧。！!]*$/.test(s));
  return beats.length >= 2 ? beats : null;
}

type LibraryImage = { imageId?: number | null; imageUrl: string; label: string };
export function orderedKeyframeRefs(text: string, library: readonly LibraryImage[], uploads: ChatImageRef[]) {
  const ids = [...new Set(inlineChatParts(text).flatMap(p => p.imageId ? [p.imageId] : []))];
  const refs = ids.map(imageId => {
    const image = library.find(item => item.imageId === imageId);
    if (!image) throw Error("引用图未在本故事读到，请从仓库重新选图。");
    return { imageId, imageUrl: image.imageUrl, label: image.label };
  });
  return [...refs, ...uploads.filter(ref => !ids.includes(ref.imageId))];
}

const boardFrames = (message: ChatMessage) =>
  message.role === "assistant" ? keyframeBoardImageIds(message.id, message.content) : [];
export function reviewedKeyframeTarget(text: string, messages: readonly ChatMessage[], shot: SelectionContext, library: readonly LibraryImage[]) {
  if (/\[\[ref:|采用|替换剪辑|生成视频|删(?:掉|除)|设为(?:首|尾)帧/.test(text)) return null;
  const match = text.match(new RegExp("^\\s*(?:请|把|我想改|修改|调整)?\\s*第\\s*("+ordinal+")\\s*(?:张|帧)"));
  if (!match || !/改|调|放大|缩小|保留|往|向|一点|一些|太|移|颜色/.test(text) || [...text.matchAll(/第\s*[1-9一二三四五六七八九两]\s*(?:张|帧)/g)].length !== 1) return null;
  const current = [...messages].reverse().find(m => m.selectionQuote?.storyId === shot.storyId && m.selectionQuote?.stableShotId === shot.stableShotId && boardFrames(m).length);
  if (!current) return null;
  const imageId = boardFrames(current)[digit(match[1]) - 1];
  const image = library.find(item => item.imageId === imageId);
  if (!imageId || !image) throw Error("这组没有可读取的对应帧，请核对编号。");
  return { imageId, imageUrl: image.imageUrl, label: "待修改的关键帧" };
}

export function keyframeChatTurns(text: string, beats: string[], refs: ChatImageRef[], selectionQuote: SelectionContext): ChatMessage[] {
  if (!refs.length) throw Error("请附上画面参考，或在输入框插入本镜的仓库图片。想法已留在输入框。");
  const turn = crypto.randomUUID(), now = Date.now();
  const original = inlineChatParts(text).filter(p => !p.imageId).map(p => p.text).join("").trim();
  const present = new Set(inlineChatParts(text).flatMap(p => p.imageId ? [p.imageId] : []));
  const rows: ChatMessage[] = [{ id: turn, role: "user", content: [text,...refs.filter(r=>!present.has(r.imageId)).map(r=>inlineImageToken(r.imageId))].join(" ").trim(), timestamp: now, selectionQuote }];
  for (const [index, beat] of beats.entries()) {
    const numbers = referenceNumbers(beat);
    if (numbers.some(n => !refs[n-1])) throw Error("镜头描述点到的截图尚未附齐，请按原顺序补图。");
    // Preserve every supplied reference until its role can be checked. Never silently truncate to the provider limit.
    if (refs.length > 4) throw Error("单帧最多可带 4 张参考图。请把这个动作及对应参考图分开发送，其他图已在仓库。");
    const base = numbers.length === 1 ? refs[numbers[0]-1] : refs.length === 1 ? refs[0] : undefined;
    const instruction = "第 "+(index+1)+" 帧只表现「"+beat+"」。完整镜头描述供前后衔接："+original;
    const plan = createChatImageEditPlan(refs, instruction);
    plan.mode = "compose";
    plan.preserve = "沿用参考中的角色、道具、色彩、材质和界面。只改变本帧明确写出的动作。";
    for (const [i,ref] of plan.images.entries()) {
      ref.role = !base ? "undecided" : ref.imageId === base.imageId ? "target" : "reference";
      ref.purpose = "原始图"+(i+1)+"。"+(ref.role === "target" ? beat : "依照原描述中这张图的职责参考，不把后续动作提前。");
    }
    rows.push({id: "shot-keyframe:"+turn+":"+index, role:"assistant",selectionQuote,timestamp:now+index+1,imageEditPlan:plan,
      content:"关键帧 "+(index+1)+"/"+beats.length+" · "+beat+"\n"+(base?"":"请为这帧选一张底图，其余选参考或不用。")+"精修预计 "+formatComputeQuote(imageEditPlanQuote(plan).unitCny)+"。生成后点图审看，可单独修改这一帧。"});
  }
  return rows;
}

export function openKeyframeReview(text: string, messages: readonly ChatMessage[], shot: SelectionContext) {
  if (!/^(?:请)?(?:查看|看看|回看|显示|再看一次)\s*(?:第\s*\d+\s*镜(?:头)?的?)?\s*(?:这组|上次的|已生成的)?关键帧[。！!]?$/u.test(text.trim())) return null;
  return [...messages].reverse().find(m => m.selectionQuote?.storyId === shot.storyId && m.selectionQuote?.stableShotId === shot.stableShotId && boardFrames(m).length);
}

export function keyframeApproval(text: string, messages: readonly ChatMessage[], shot: SelectionContext) {
  const all = /^(?:这组|这几张|全部|所有)(?:的)?(?:关键帧|画面|图片)?(?:我)?(?:都)?(?:满意|认可|符合我的想法|可以)[！!。\s]*$/.test(text.trim());
  const one = text.trim().match(new RegExp("^第\\s*("+ordinal+")\\s*(?:张|帧)(?:我)?(?:满意|认可|可以)[！!。\\s]*$"));
  if (!all && !one) return null;
  const board = [...messages].reverse().find(m => m.selectionQuote?.storyId === shot.storyId && m.selectionQuote?.stableShotId === shot.stableShotId && boardFrames(m).length);
  if (!board) return null;
  const ids = boardFrames(board);
  if (one && !ids[digit(one[1])-1]) throw Error("这一组没有对应帧号，请核对。");
  const approved = one ? [ids[digit(one[1])-1]] : ids;
  return "已记下你认可的画面 "+approved.map(id=>"#"+id).join("、")+"。"+(all?"接下来想补充动作和时长，还是先看逐秒视频方案？":"其余帧可以继续审看。");
}

/** Re-show an existing board only for the same shot, wording and ordered source images. */
export function matchingKeyframeReview(text: string, refs: ChatImageRef[], messages: readonly ChatMessage[], shot: SelectionContext) {
  const rows = messages.filter(m => m.selectionQuote?.storyId === shot.storyId && m.selectionQuote?.stableShotId === shot.stableShotId);
  const end = rows.map(m => boardFrames(m).length > 0).lastIndexOf(true);
  if (end < 0 || rows.slice(end + 1).some(m => m.role === "user")) return null;
  const plain = (s: string) => inlineChatParts(s).filter(p=>!p.imageId).map(p=>p.text).join("").replace(/[\s。.!！]+$/g,"").replace(/\s+/g,"");
  const current = refs.map(r=>r.imageId);
  // For an authored board, keep the follow-up style instruction with its original brief.
  // Stop at a different production turn so an older source group cannot claim a newer result.
  for (let index=end-1;index>=0;index--) {
    const row=rows[index];
    if (row.role!=="user") break;
    const original=inlineChatParts(row.content).flatMap(p=>p.imageId?[p.imageId]:[]);
    if (plain(row.content)===plain(text) && current.length===original.length && original.every((id,i)=>id===current[i])) return rows[end];
  }
  return null;
}
