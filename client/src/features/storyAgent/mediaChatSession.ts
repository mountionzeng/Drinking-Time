import { create } from "zustand";

type Question = { storyId: number; text: string; kind: "cost" | "placement" | "continuity"; videoUrl?: string };
type Session = { finish?: (accepted: boolean) => void; cancelled: boolean };
const sessions = new Map<number, Session>();
export const mediaChatQuestionStore = create<{ question: Question | null }>(() => ({ question: null }));

/** Existing renderers keep their quote, but conversations answer it in place. */
export async function withMediaChatSession<T>(storyId: number, run: () => Promise<T>): Promise<T> {
  if (sessions.has(storyId)) throw new Error("当前制作尚未结束，请先回答对话中的问题");
  const session: Session = { cancelled: false };
  sessions.set(storyId, session);
  try { return await run(); }
  finally {
    if (sessions.get(storyId) === session) {
      cancelMediaChatSession(storyId);
      sessions.delete(storyId);
    }
  }
}

export function hasMediaChatSession(storyId: number) { return sessions.has(storyId); }

export function cancelMediaChatSession(storyId: number) {
  const session = sessions.get(storyId);
  if (session) { session.cancelled = true; session.finish?.(false); }
  if (mediaChatQuestionStore.getState().question?.storyId === storyId)
    mediaChatQuestionStore.setState({ question: null });
}

export function askMediaChatConfirmation(question: Question): Promise<boolean> | null {
  const session = sessions.get(question.storyId);
  if (!session) return null;
  if (session.cancelled) return Promise.resolve(false);
  session.finish?.(false);
  return new Promise(resolve => {
    session.finish = accepted => {
      session.finish = undefined;
      if (mediaChatQuestionStore.getState().question === question)
        mediaChatQuestionStore.setState({ question: null });
      resolve(accepted && !session.cancelled);
    };
    mediaChatQuestionStore.setState({ question });
  });
}

export function answerMediaChatQuestion(storyId: number, text: string): "answered" | "unknown" | "none" {
  const question = mediaChatQuestionStore.getState().question;
  if (question?.storyId !== storyId) return "none";
  const value = text.trim().replace(/[。.!！]+$/u, "");
  const no = /^(?:取消|先不|先不生成|先保留|不放入|不放|不要|不要生成|no|cancel|keep it)$/i.test(value);
  const yes = /^(?:确认|确认生成|确认，?生成这一张|确认，?生成这一条|生成|继续|好|好的|可以|yes|confirm|generate)$/i.test(value) ||
    question.kind === "placement" && /^(?:放入|放进去|放入第\s*(?:0*\d+|一|二|三|四|五|六|七)\s*(?:个)?镜头?|采用|place it)$/i.test(value);
  if (!yes && !no) return "unknown";
  sessions.get(storyId)?.finish?.(yes);
  return "answered";
}
