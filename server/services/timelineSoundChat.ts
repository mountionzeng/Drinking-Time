import { parseSoundChat, applySoundChat } from "../../shared/soundChat";
import type { VisualEditOperationRef } from "../../shared/visualEditReceipt";
import { runMediaCommand } from "./timelineAudioEditing";

export async function editTimelineSoundFromChat(input: { storyId: number; userId: number; operation: VisualEditOperationRef; instruction: string }) {
  const intent = parseSoundChat(input.instruction);
  if (!intent || intent.type !== "edit") return { status: "error" as const, error: intent?.reply ?? "没有识别到声音修改要求。", errorKind: "invalid" as const };
  return runMediaCommand({ ...input, mediaVersionIntent: input.instruction, commandPayload: { type: "sound-chat", instruction: input.instruction, commands: intent.commands } }, slices => {
    const result = applySoundChat(slices.audio, intent.commands);
    return result.status === "error" ? result : { status: "ok", changed: result.changed, nextExtensions: { audioTracks: result.state } };
  });
}
