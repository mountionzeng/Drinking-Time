import { adjustedImageEditPlanId, confirmedImageEditPlanId, keyframeBoardImageIds, type ChatImageEditPlan } from "@shared/chatImageEditPlan";
import { inlineChatParts, inlineImageToken } from "@shared/inlineChatImages";
import type { SelectionContext } from "@shared/selectionContext";
import type { ChatMessage } from "./types";

type LibraryImage = { imageId?: number | null; imageUrl: string; label: string };
type PlanImage = ChatImageEditPlan["images"][number];
const edge = /(?:边界|边缘|交界|衔接|交接|接缝|融合|拼贴|贴上去|抠图|硬切)/;
const collective = /整组|全组|整套|每一?张|全部|所有|全都|这组|这几张|(?:[\d一二两三四五六七八九十]+\s*[张帧](?:图片?|关键帧)?|这些图)\s*(?:一起|都|统一|分别|全)/;
const action = /改|调|优化|处理|统一|柔和|柔化|自然|太硬|生硬|突兀|过亮|过暗|降低|提高/;
const limited = /(?:只(?:想|要|需要)?|仅(?:需|限)?|单独)\s*(?:改|调|处理|修改|调整)?\s*(?:这|那|第|[\d一二两三四五六七八九十])/;
const otherAction = /(?:不要|不用|先别|先不|暂不|别|不需要)(?:把|将|再)?(?:这|那)?[\d一二两三四五六七八九十]+张(?:图|关键帧)?(?:都|一起|全)?(?:改|调|修)|[?？]|(?:能否|可不可以|可以吗|为什么|怎么会|是不是)|(?:先不|暂不|别|不要|不用|不必|取消)\s*(?:(?:这|把|再|整组|一起|都|全|改动|五张|5张)\s*)*(?:改|调|修|生成)|(?:删除|移除|采用|替换剪辑|生成视频|渲染视频)/;
const soften = "按各帧原有画法，统一物体交界的受光、反射色、纹理尺度、边缘锐度和接触阴影，消除贴片感。保留纸张折线、屏幕轮廓和界面图标、文字的清晰度。";
const protect = "保留每帧的主体、构图、位置、大小、颜色和画幅。只处理原画已有的物体。";

function statedCount(text: string) {
  const m = text.match(/(\d+|[一二两三四五六七八九十]+)\s*[张帧](?:图片?|关键帧)?\s*(?:一起|都|统一|分别|全)/);
  return m ? imageCount(m[1]) : undefined;
}

function imageCount(value: string) {
  if (/^\d+$/.test(value)) return Number(value);
  const digit = (n: string) => "零一二三四五六七八九".indexOf(n.replace("两", "二"));
  const [tens, ones] = value.split("十");
  return ones === undefined ? digit(tens) : (tens ? digit(tens) : 1) * 10 + (ones ? digit(ones) : 0);
}

function archivedText(value: string) {
  return value.replace(/图\d+[（(]图片 #(\d+)[）)]/g, "#$1").replace(/^(?:这)?两张分别保留/, "每帧保留");
}

export function keyframeGroupEdit(text: string, messages: readonly ChatMessage[], shot: SelectionContext,
  library: readonly LibraryImage[], selectedImageId?: number | null): { turns: ChatMessage[]; repeatId?: string } | null {
  const policyFeedback = /生成任何|每次.{0,8}(?:生成|渲染)|所有.{0,8}(?:生成|渲染)/.test(text) &&
    /先.{0,18}(?:画面本身|原图|读图|看图)/.test(text) && /分析|判断|核对/.test(text);
  if (policyFeedback && shot.stableShotId && !otherAction.test(text)) {
    const scoped = messages.filter(m => m.selectionQuote?.storyId === shot.storyId && m.selectionQuote?.stableShotId === shot.stableShotId);
    const last = scoped.at(-1);
    if (last?.id.startsWith("source-reading-policy:") && scoped.at(-2)?.content === text) return {turns:[],repeatId:last.id};
    const id=crypto.randomUUID(), now=Date.now();
    return {turns:[
      {id,role:"user",timestamp:now,content:text,selectionQuote:shot},
      {id:"source-reading-policy:"+id,role:"assistant",timestamp:now+1,selectionQuote:shot,
        content:"有原图的生成会先逐张读画面，按已有的明暗和轮廓确定怎么改。材质接缝要衔接自然，纸张折线、按钮和文字保持清晰。展开本镜报价里的「查看画面依据」可以核对原图。"}
    ]};
  }
  if (!shot.stableShotId || limited.test(text) || otherAction.test(text)) return null;
  // Requesting the pictures can follow a policy discussion as well as the quote itself.
  const delivery = text.match(/(?:^|[，,。]\s*|然后)(?:然后)?(?:请|麻烦)?(?:给我(?:看(?:看)?)?|发给我|发我|让我看(?:看)?|我想看)\s*(\d+|[一二两三四五六七八九十]+)\s*张\s*(?:(?:正确|修改好|改好|改完|修好|修订后|最新|完成)的)?(?:图片?|关键帧)[吧。！!\s]*$/);
  const lead = delivery ? text.slice(0, delivery.index).trim() : "";
  const asksForResults = !!delivery && (!lead || /^(?:(?:请|你|希望|至少|需要|要|先|再|在|能|可以|帮我|的|里|里面|聊天|对话框|识别|理解|我的|需求|要求)\s*)+$/.test(lead) ||
    /^(?:按|按照|根据)(?:刚才|前面|上一条|之前)(?:说的|的)?(?:要求|修改意见|反馈)?$/.test(lead));
  if (delivery && !asksForResults && !action.test(lead)) return null;
  if (!delivery && !action.test(text)) return null;
  const explicit = collective.test(text) || !!delivery;
  const sharedFeedback = /整体|全片|统一/.test(text) && edge.test(text) && /背景|画风|美术|材质/.test(text);
  const unscopedEdge = edge.test(text) && !selectedImageId && !/第\s*[\d一二两三四五六七八九十]+|这[一二两三四五六七八九十\d]*张|那张|这一帧|那一帧|#\d+|\[\[ref:/.test(text);
  if (/音(?:乐|轨|量)|旁白|字幕轨|视频|剪辑线/.test(text) && !/图片|关键帧|张图/.test(text)) return null;
  if (!delivery && !explicit && !sharedFeedback && !unscopedEdge) return null;

  const rows = messages.filter(m => m.selectionQuote?.storyId === shot.storyId && m.selectionQuote?.stableShotId === shot.stableShotId);
  const boardIndex = rows.map(m => m.role === "assistant" && m.id.startsWith("saved-photos:") && /关键帧初稿|关键帧修订稿/.test(m.content)).lastIndexOf(true);
  if (boardIndex < 0) {
    if (!delivery && explicit && /图片|画面|关键帧|张|边界|边缘/.test(text)) throw Error("本镜还没有可核对的整组关键帧，请先打开对应镜头的审图记录。");
    return null;
  }
  const board = rows[boardIndex];
  const ids = keyframeBoardImageIds(board.id, board.content);
  const count = delivery ? imageCount(delivery[1]) : statedCount(text);
  const declared = board.content.match(/关键帧(?:初稿|修订稿)[（(]\s*(\d+)\s*张/);
  if (!ids.length || declared && Number(declared[1]) !== ids.length || ids.length > 12 || (count !== undefined && count !== ids.length))
    throw Error("本镜审图记录与请求张数不一致，请核对后再修改。");
  if (asksForResults) {
    for (const id of ids) {
      if (!library.some(image => image.imageId === id && image.imageUrl?.trim()))
        throw Error("本镜素材中找不到图片 #" + id + "，请先核对原图。");
    }
    const afterBoard = rows.slice(boardIndex + 1);
    const latestPlan = [...afterBoard].reverse().find(m => m.role === "assistant" && m.imageEditPlan);
    const plan = latestPlan?.imageEditPlan;
    const targets = plan?.regionScanSourceId ? plan.images : plan?.images.filter(image => image.role === "target") ?? [];
    if (plan && (plan.keyframeBoardId !== board.id || targets.length !== ids.length ||
      !targets.every((target, index) => target.imageId === ids[index]))) return null;
    const now = Date.now(), uuid = crypto.randomUUID();
    const user: ChatMessage = { id: uuid, role: "user", content: text, timestamp: now, selectionQuote: shot };
    const completed = !plan && /关键帧修订稿/.test(board.content);
    const labels = board.content.split("\n").filter(line => /\[\[ref:/.test(line))
      .map(line => inlineChatParts(line).filter(part => !part.imageId).map(part => part.text).join("").replace(/^\s*\d+[\s、.．]*/, "").trim());
    const summary = labels.length === ids.length && labels.every(Boolean) ? labels.join(" → ") + "。" : "";
    const content = completed
      ? "这 " + ids.length + " 张是本镜最近完成的修订图，按镜内顺序排列。\n" +
        ids.map((id, index) => (index + 1) + "　" + (labels[index] || "") + "　" + inlineImageToken(id)).join("\n")
      : "你要看本镜 " + ids.length + " 张分别改好的画面。" + summary +
        (plan?.status === "submitted" ? "这组已有提交记录，结果以本镜的完成回执为准。" :
          plan ? "已接上这组的修改要求。" + (edge.test(plan.changes) ? soften : "") + "修订图还没交回本镜。" :
          "目前保存的是初稿，尚无对应的修订图。");
    return { turns: [user, { id: (completed ? "saved-photos:keyframe-recall:" : "keyframe-delivery-request:") + uuid,
      role: "assistant", content, timestamp: now + 1, selectionQuote: shot }] };
  }
  const parts = inlineChatParts(text);
  const latest = rows.at(-1)?.id.startsWith("source-reading-policy:") ? rows.at(-3) : rows.at(-1);
  const viewingGroup = latest?.id === board.id ||
    (latest?.imageEditPlan?.keyframeBoardId === board.id && latest.imageEditPlan.status === "draft");
  const examples = new Set(parts.filter(p => p.imageId && ids.includes(p.imageId)).map(p => p.imageId));
  if (!explicit && !(viewingGroup && unscopedEdge) && !(sharedFeedback && examples.size >= 2)) return null;

  const later = rows.slice(boardIndex + 1);
  const previous = later.slice().reverse().find(m => m.role === "assistant" && m.imageEditPlan);
  const prior = previous?.imageEditPlan;
  const targets = prior?.images.filter(i => i.role === "target") ?? [];
  const related = previous && prior?.status === "draft" && targets.length && targets.every(i => ids.includes(i.imageId)) &&
    (!prior.keyframeBoardId || prior.keyframeBoardId === board.id) &&
    !rows.some(m => m.id === confirmedImageEditPlanId(previous.id) || m.id === adjustedImageEditPlanId(previous.id)) ? previous : undefined;
  if (related === later.at(-1) && related?.imageEditPlan?.keyframeBoardId && later.at(-2)?.content === text)
    return { turns: [], repeatId: related.id };
  const old = related?.imageEditPlan;
  const lookup = (id: number) => {
    const image = library.find(i => i.imageId === id && i.imageUrl?.trim());
    if (!image) throw Error("本镜素材中找不到图片 #" + id + "，请先核对原图。");
    return { imageId: id, imageUrl: image.imageUrl, label: image.label };
  };
  const refs = new Map<number, PlanImage>();
  for (const ref of old?.images ?? []) if (ref.role === "reference" && !ids.includes(ref.imageId))
    refs.set(ref.imageId, { ...ref, ...lookup(ref.imageId) });
  for (const [index, part] of parts.entries()) {
    const id = part.imageId;
    if (!id || ids.includes(id)) continue;
    const adjacent = [parts[index - 1]?.text?.replace(/[（(][^）)]*[）)]/g, "").split(/[。；，,\n]/).at(-1), parts[index + 1]?.text?.split(/[。；，,\n]/)[0]].join(" ");
    if (!/(?:参考|参照|借鉴)/.test(adjacent)) {
      if (!refs.has(id)) throw Error("请说明图片 #" + id + " 用来参考什么。");
      continue;
    }
    const purpose = /背景/.test(adjacent) && /丰富|疏密|层次/.test(adjacent)
      ? "仅参考背景的疏密、层次和丰富程度，沿用各帧原有配色、物件和布局。" : adjacent.trim();
    refs.set(id, { ...lookup(id), role: "reference", copies: 1, purpose });
  }
  if (refs.size > 3) throw Error("每帧最多可带三张参考图，请明确要用哪三张。");

  const direction = parts.map(p => p.imageId ? "#" + p.imageId : p.text).join("");
  const bareScope = !direction.replace(collective, "").replace(/(?:请|把|这些图|图片|一起|统一|都|全|分别|再|帮我|改一改|修改|调整|改|一下|吧|[\s，,。！!])/g, "");
  if (bareScope && !old?.changes) throw Error("已找到本镜整组关键帧，请补充想统一改哪里。");
  // Old ordinals describe the old reference tray, never the current board order.
  const changes = [...new Set([...(old?.changes ? archivedText(old.changes).split("\n") : []), !bareScope && direction, edge.test(text) && soften].filter(Boolean))].join("\n");
  const plan: ChatImageEditPlan = {
    status: "draft", mode: "separate", renderRoute: "precision", keyframeBoardId: board.id,
    changes, details: old?.details ?? "", preserve: old?.preserve ? archivedText(old.preserve) : protect,
    images: [...ids.map((id, index): PlanImage => ({
      ...lookup(id), label: "关键帧 " + (index + 1) + " · #" + id, role: "target", copies: 1,
      purpose: old?.images.find(i => i.imageId === id && i.role === "target")?.purpose ||
        "仅精修这张原图中已有的元素，保留本帧的动作、构图和界面内容。",
    })), ...refs.values()],
  };
  const now = Date.now();
  const user: ChatMessage = { id: crypto.randomUUID(), role: "user", timestamp: now, content: text, selectionQuote: shot };
  const id = related ? adjustedImageEditPlanId(related.id) : "board-edit:" + user.id;
  const content = "本镜 " + ids.length + " 张关键帧各精修一张。" +
    (edge.test(text) ? "统一处理材质、受光和接触阴影，保留界面细节。" : "") +
    [...refs.values()].map(r => " #" + r.imageId + " " + r.purpose).join("");
  return { turns: [user, { id, role: "assistant", timestamp: now + 1, content, imageEditPlan: plan, selectionQuote: shot }] };
}
