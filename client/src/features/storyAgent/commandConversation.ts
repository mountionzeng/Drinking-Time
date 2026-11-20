import { explicitReferenceShotNumber } from "@shared/chatFrameReference";
import type { SelectionContext } from "@shared/selectionContext";
import type { ChatMessage } from "./types";
import { parseDialogueVisualSync } from "@shared/dialogueVisualSync";

const shortAcknowledgement = /^(?:ok(?:ay)?|好(?:的)?|收到|嗯)[。.!！\s]*$/iu;

/** Resolve a picture timing instruction against the immediately preceding feedback on the same shot. */
export function wordTimingCommand(
  text: string, messages: readonly ChatMessage[], storyId: number,
  selection?: { stableShotId?: string | null; shotNo?: number | null; videoTakeId?: number | null }
) {
  const last = messages.at(-1);
  const prior = messages.slice(0, last?.role === "user" && last.content.trim() === text.trim() ? -1 : undefined)
    .findLast(message => message.role === "user");
  let explicit: number | null;
  try { explicit = explicitReferenceShotNumber(text); }
  catch { return /[“「"'](?:[a-z]+)[”」"']/iu.test(text) && /画面|视频|上屏/u.test(text) && /提前|慢了|快一点/u.test(text)
    ? { reply: "请先指定要剪的一个镜头。" } : null; }
  const shotNo = explicit ?? selection?.shotNo;
  const sameShot = prior?.selectionQuote?.storyId === storyId && selection?.stableShotId &&
    prior.selectionQuote.stableShotId === selection.stableShotId && shotNo === selection.shotNo;
  const quoted = (s: string) => s.match(/[“「"'‘]([a-z]+)[”」"'’]/iu)?.[1];
  const earlier = /还是|仍然|刚才|刚刚|这次|那段|直接剪/u.test(text) && sameShot ? prior.content : "";
  const word = quoted(text) || quoted(earlier);
  const visual = /画面|视频|屏幕|上屏/u.test(text);
  if (!/(?:还是|太|偏|仍然)?慢了|太慢|偏慢|快一[点些]|提前|提早/u.test(text) ||
      (!word && !(visual && /(?:不是|不改|只改).{0,15}(?:音轨|声音|视频|画面)/u.test(text))) || /(?:改|动|调)(?:一下|的是|快|慢)?(?:旁白|音轨|语速|声音)/u.test(text.replace(/(?:不是|不要|不|别)(?:改|动|调)(?:旁白|音轨|声音)/gu, "")) ||
      (!visual && /旁白|语速|音轨/u.test(text))) return null;
  const request = text.replace(/(?:不是|不要改|不改|别改|只保留)(?:原)?(?:音轨|旁白|声音)/gu, "");
  if (/(?:把|让|将)(?:原)?(?:音轨|旁白|声音|配音).{0,12}(?:提前|快一点|提早)/u.test(request)) return null;
  if (/(?:不要|不用|不必|别)(?:再)?(?:提前|提早|加快)|比方说|举例|先看看|先试算|先预览|下次|下一次|下一版|只(?:记|留)|不(?:用|要|必)(?:现在)?(?:剪|改)|别(?:剪|改)|能不能|如果|[?？]/u.test(text.replace(/(?:不要|不用|别)改(?:音轨|旁白|声音)/gu, "")))
    return { reply: "已记下这条画面节奏反馈。准备好时，可以直接说要把哪个词的画面提前。" };
  if (!word || (!shotNo && !selection?.stableShotId))
    return { reply: "请选中镜头，并用引号标出想提前显示的那个词。" };
  const hold = /停顿|停一|停留|定格/u;
  const holdText = hold.test(text) ? text : earlier;
  if (/提前\s*\d|停(?:留|顿)?\s*\d|延后|推迟/u.test(text)) return { reply: "这条包含具体时长或其他方向，请用剪辑线的逐帧编辑指定位置。" };
  return { word, shotNo, sourceTakeId: Number(text.match(/Take\s*#\s*(\d+)/iu)?.[1]) || (shotNo === selection?.shotNo ? selection?.videoTakeId : undefined) || undefined,
    hold: hold.test(holdText) && !/(?:不(?:要|用|必)?|别).{0,4}(?:停|定格)/u.test(holdText) };
}

/** Called after explicit editor actions and before the model-based classifier. */
export function videoAcknowledgement(
  instruction: string, messages: readonly ChatMessage[], storyId: number, stableShotId?: string | null
): string | null {
  if (!shortAcknowledgement.test(instruction.trim())) return null;
  let i = messages.length - 1;
  while (i >= 0 && messages[i].role === "user" && shortAcknowledgement.test(messages[i].content.trim())) i--;
  const preview = messages[i];
  const request = messages[i - 1];
  const target = request?.selectionQuote;
  if (preview?.role === "assistant" && preview.content.startsWith("试算结果：") &&
      request?.role === "user" && target?.storyId === storyId && target.stableShotId &&
      target.stableShotId === stableShotId && target.shotNo) {
    const edit = request.content.replace(/^先试算\s*[：:]\s*/u, "");
    const sync = parseDialogueVisualSync(edit);
    if (sync && !sync.preview && !sync.ambiguous && sync.shotNo === target.shotNo)
      return `收到。第 ${String(target.shotNo).padStart(2, "0")} 镜目前保留试算。要应用这次剪辑，请发送「${edit}」。`;
  }
  return "收到。要继续剪辑，可以告诉我想改哪个镜头，以及希望它怎么变。";
}

export function interruptedChatReply(error: unknown): string {
  const code = (error as { data?: { code?: string } } | null)?.data?.code;
  if (code === "UNAUTHORIZED") return "登录已失效。请重新登录，回到这条消息继续。";
  if (code === "FORBIDDEN") {
    if (error instanceof Error && error.message.includes("算力余额不足"))
      return "这次请求因算力余额不足而停止。可以查看算力明细，或继续手工剪辑。";
    return "当前账号没有执行这项操作的权限。可以核对账号和所选故事。";
  }
  if (code === "BAD_REQUEST") return "这次请求未通过校验。请核对消息里的镜头或素材引用，再补充修改要求。";
  return "这次未收到完整回复，执行结果待核对。原话和引用保留在这里。请先查看当前剪辑或任务记录，避免重复提交。";
}

export function insertTurnReply(messages: ChatMessage[], user: ChatMessage, reply: ChatMessage): ChatMessage[] {
  const at = messages.findIndex(m => m.id === user.id && m.role === "user");
  if (at < 0 || messages.some(m => m.id === reply.id)) return messages;
  return [...messages.slice(0, at + 1), reply, ...messages.slice(at + 1)];
}

type CommandTurn = {
  storyId: number;
  userMessage: {
    clientMessageId: string;
    content: string;
    selection: SelectionContext | null;
  };
  assistantMessage: { clientMessageId: string; content: string };
};
/** Store the command's receipt without executing it again when chat persistence fails. */
export async function appendCommandConversation(
  append: (input: CommandTurn) => Promise<unknown>,
  storyId: number | null,
  user: ChatMessage,
  assistant: ChatMessage,
  selection: SelectionContext | null
): Promise<boolean> {
  if (storyId == null) return false;
  try {
    await append({
      storyId,
      userMessage: {
        clientMessageId: user.id,
        content: user.content,
        selection: user.selectionQuote ? selection : null,
      },
      assistantMessage: {
        clientMessageId: assistant.id,
        content: assistant.content,
      },
    });
    return true;
  } catch (error) {
    console.warn("[storyConversation] persist command turn failed:", error);
    return false;
  }
}
