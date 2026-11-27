import { storySpineStore } from "@/features/storyAgent/spine/storySpine";
import type { ChatMessage } from "@/features/storyAgent/types";

/** Only the mounted editor can resume a production question for its own shot. */
type ProductionQuestion = {
  storyId: number;
  scope: string;
  current(): boolean;
  answer(value: string): Promise<string>;
};
let pending: ProductionQuestion | undefined;
let answering = false;
let nextQuestion: ChatMessage | undefined;
type RecordedTurn = {storyId:number; user:ChatMessage; reply:ChatMessage; claimed?: boolean};
export function listenForProductionTurns(storyId:number|null, save:(turn:RecordedTurn)=>void) {
  const receive=(event:Event)=>{
    const detail=(event as CustomEvent<RecordedTurn>).detail;
    if (!detail || detail.claimed || detail.storyId!==storyId) return;
    detail.claimed=true;save(detail);
  };
  window.addEventListener("dt:book-production-turn",receive);
  return ()=>window.removeEventListener("dt:book-production-turn",receive);
}
function record(storyId:number,user:ChatMessage,reply:ChatMessage) {
  window.dispatchEvent(new CustomEvent<RecordedTurn>("dt:book-production-turn",{detail:{storyId,user,reply}}));
}

function message(role: ChatMessage["role"], content: string): ChatMessage {
  return { id: "book-production:" + crypto.randomUUID(), role, content, timestamp: Date.now() };
}
export function clearProductionQuestion(scope?: string) {
  if (scope === undefined || pending?.scope === scope) pending = undefined;
}
export function askProductionQuestion(question: ProductionQuestion, prompt: string, action: string) {
  if (!question.current()) return;
  pending = question;
  const reply=message("assistant",prompt);
  const spine=storySpineStore.getState();
  if (answering) {
    nextQuestion=reply; spine.setMessages(rows=>[...rows,reply]);
  } else {
    const user=message("user",action);
    spine.setMessages(rows=>[...rows,user,reply]);record(question.storyId,user,reply);
  }
}
export async function answerProductionQuestion(storyId: number | null, text: string) {
  const question = pending;
  if (!question || question.storyId !== storyId || !text.trim()) return false;
  if (answering) return true;
  pending = undefined;
  const spine = storySpineStore.getState();
  const sameStory = () => {
    const now = storySpineStore.getState();
    return now.activeStoryId === spine.activeStoryId && now.accountId === spine.accountId && now.storyScopeEpoch === spine.storyScopeEpoch;
  };
  if (!question.current()) {
    if (sameStory()) spine.setMessages(rows => [...rows, message("assistant","本镜内容已变化，请重新点要制作的栏目。")]);
    return true;
  }
  const user = message("user",text);
  spine.setMessages(rows => [...rows,user]);
  answering = true;
  nextQuestion = undefined;
  try {
    const reply = /^(?:取消|算了|稍后|先不做)[。！!\s]*$/u.test(text.trim())
      ? "已收起本次制作。" : await question.answer(text.trim());
    if (sameStory()) {
      const receipt=nextQuestion ?? message("assistant",reply || "已记录本镜要求。");
      if (!nextQuestion) spine.setMessages(rows=>[...rows,receipt]);
      record(question.storyId,user,receipt);
    }
  } catch (cause) {
    if (sameStory()) spine.setMessages(rows => [...rows,message("assistant",cause instanceof Error ? cause.message : "未能准备本镜，请重新点选。")]);
  } finally { answering = false; nextQuestion=undefined; }
  return true;
}
