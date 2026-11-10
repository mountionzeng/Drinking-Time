import { MAX_AUDIO_GAIN, type AudioTrackKind, type TimelineAudioState } from "./timelineAudioModel";

export type SoundChatCommand = {
  kind: AudioTrackKind;
  action: { type: "gain"; value: number; relative: boolean } | { type: "mute"; value: boolean } | { type: "fade"; edge: "in" | "out"; seconds: number };
};
export type SoundChatIntent = { type: "edit"; commands: SoundChatCommand[] } | { type: "unsupported"; reply: string };
const targets: Array<[AudioTrackKind, RegExp]> = [
  ["music", /背景音乐|背景配乐|配乐|音乐|\bbgm\b|\bmusic\b/i],
  ["narration", /旁白|有声书|朗读|\bnarration\b|\bvoiceover\b/i],
  ["dialogue", /台词|对白|\bdialogue\b/i],
  ["ambience", /环境声|\bambience\b/i],
  ["sfx", /音效|\bsfx\b/i],
];
export const SOUND_CHAT_HELP = "还未修改。现在可以直接说“背景音乐小一点”“旁白音量调到80%”“音乐淡出2秒”或“取消音乐静音”。换音乐、语速和字幕对齐需要对应的声音生成或对齐流程。";

/** Deliberately bounded grammar: never execute a partial interpretation of a compound request. */
export function parseSoundChat(text: string): SoundChatIntent | null {
  const parts = text.trim().split(/[,，;；。\n]+|并且|然后|\band\b/i).map(s => s.trim()).filter(Boolean);
  if (!targets.some(([, re]) => re.test(text)) && !/声音|音频|字幕|sound|audio/i.test(text)) return null;
  // Questions/discussion are left to normal conversation; explicit mixed or unsupported edits are not.
  if (/怎么|如何|能不能|可以吗|是否|\bhow\b|\bcan\b/i.test(text)) return null;
  const commands: SoundChatCommand[] = [];
  for (const part of parts) {
    const matches = targets.filter(([, re]) => re.test(part));
    if (matches.length !== 1) return { type: "unsupported", reply: SOUND_CHAT_HELP };
    const kind = matches[0][0];
    const body = part.replace(matches[0][1], "").replace(/^(请|帮我|我觉得|把|将|再|让|整段|全部|全片|的|\s)+/g, "").trim();
    if (/^(取消静音|恢复声音|unmute)[!！]?$/i.test(body)) commands.push({ kind, action: { type: "mute", value: false } });
    else if (/^(静音|关闭|关掉|mute)[!！]?$/i.test(body)) commands.push({ kind, action: { type: "mute", value: true } });
    else if (/^(声音|音量)?(再)?(小|低|轻)(一点|一些|点|些)[!！]?$|^(太响了?|太大了?|有点大)$|^(quieter|softer|lower)(\s+volume)?$/i.test(body)) commands.push({ kind, action: { type: "gain", value: 0.8, relative: true } });
    else if (/^(声音|音量)?(再)?(大|高|响)(一点|一些|点|些)[!！]?$|^(太小了?|有点小|听不清)$|^(louder|higher)(\s+volume)?$/i.test(body)) commands.push({ kind, action: { type: "gain", value: 1.25, relative: true } });
    else {
      const gain = body.match(/^(?:的)?(?:声音|音量|volume)?\s*(?:调到|调成|改到|改成|设为|设置为|到|为|至|to|at|=)\s*(\d+(?:\.\d+)?)\s*[%％][!！]?$/i);
      const fade = body.match(/^(?:在)?(?:结尾|开头)?\s*(淡入|淡出|fade in|fade out)\s*(\d+(?:\.\d+)?)\s*(秒|s|seconds?)[!！]?$/i);
      if (gain && Number(gain[1]) <= MAX_AUDIO_GAIN * 100) commands.push({ kind, action: { type: "gain", value: Number(gain[1]) / 100, relative: false } });
      else if (fade && Number(fade[2]) <= 30) commands.push({ kind, action: { type: "fade", edge: /淡入|fade in/i.test(fade[1]) ? "in" : "out", seconds: Number(fade[2]) } });
      else return { type: "unsupported", reply: SOUND_CHAT_HELP };
    }
  }
  return commands.length ? { type: "edit", commands } : null;
}

export function applySoundChat(state: TimelineAudioState, commands: SoundChatCommand[]) {
  const next = structuredClone(state);
  for (const command of commands) {
    const track = next.tracks.find(t => t.kind === command.kind);
    if (!track?.clips.length) return { status: "error" as const, message: "这个声音轨还没有素材，未进行修改。" };
    const action = command.action;
    if (action.type === "mute") track.muted = action.value;
    if (action.type === "gain") {
      // Absolute values describe audible clip gain, not an extra multiplier on the old mix.
      for (const clip of track.clips) clip.gain = Math.min(MAX_AUDIO_GAIN, Math.max(0,
        action.relative ? clip.gain * track.defaultGain * action.value : action.value));
      track.defaultGain = 1;
    }
    if (action.type === "fade") for (const clip of track.clips) {
      const key = action.edge === "in" ? "fadeInFrames" : "fadeOutFrames";
      clip[key] = Math.min(clip.durationFrames, Math.round(action.seconds * 30));
    }
  }
  return { status: "ok" as const, state: next, changed: JSON.stringify(next) !== JSON.stringify(state) };
}
