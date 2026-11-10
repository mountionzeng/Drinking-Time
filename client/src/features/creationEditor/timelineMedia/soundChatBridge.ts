import type { SoundChatIntent } from "@shared/soundChat";
type Runner = (instruction: string, intent: SoundChatIntent) => Promise<{ handled: true; reply: string }>;
const runners = new Map<number, Runner>();
export function registerSoundChatRunner(storyId: number, runner: Runner) {
  runners.set(storyId, runner);
  return () => { if (runners.get(storyId) === runner) runners.delete(storyId); };
}
export async function runSoundChat(storyId: number, instruction: string, intent: SoundChatIntent) {
  if (intent.type === "unsupported") return { handled: true as const, reply: intent.reply };
  const runner = runners.get(storyId);
  if (!runner) return { handled: true as const, reply: "视频声音还没有载入完成，请稍后重试；尚未修改。" };
  try { return await runner(instruction, intent); }
  catch (cause) { return { handled: true as const, reply: `声音修改未完成：${cause instanceof Error ? cause.message : "请稍后重试"}` }; }
}
