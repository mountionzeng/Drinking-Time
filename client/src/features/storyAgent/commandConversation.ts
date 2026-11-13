import type { SelectionContext } from "@shared/selectionContext";
import type { ChatMessage } from "./types";

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
