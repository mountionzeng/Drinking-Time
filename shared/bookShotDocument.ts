import { bookShotLinks, type BookShotLink } from "./bookShotLinks";
import { readBookAudio } from "./bookAudioBlock";
import { readShotField, sceneSetting, splitSoundSpeechTiming, type ShotField } from "./bookShotFormat";
import { readBookImage } from "./bookImageBlock";
import { spokenBookDialogue } from "./bookSound";
import { writingModuleTexts, type BookWritingStyle } from "./bookWritingStyle";
import { pictureDirections } from "./stillVisualDescription";

export type BookShotChapter = { id: number; blocks: {
  body: string; storyboardScenes?: boolean; writingStyle?: BookWritingStyle; shotTextOrigin?: { shotNo?: number };
} };
type MediaAudio = NonNullable<ReturnType<typeof readBookAudio>>;
type MediaImage = NonNullable<ReturnType<typeof readBookImage>>;
type Shot = {
  link?: BookShotLink;
  id: string; title: string; moduleId: string; sourceModuleIds: string[];
  chapterId: number; targets: Partial<Record<ShotField, { moduleId: string; offset: number }>>;
  text: string; notes: string; dialogueText: string; images: MediaImage[]; audio: MediaAudio[];
};

export function bookManuscriptModules(blocks: BookShotChapter["blocks"]) {
  return writingModuleTexts(blocks.body, blocks.writingStyle).map((text, i) => {
    const row = blocks.writingStyle?.[i];
    return { row, text, image: readBookImage(text), audio: readBookAudio(text),
      dialogue: row?.videoRole === "dialogue" ? spokenBookDialogue(text) : undefined };
  });
}

/** Read the same shot and source IDs for the manuscript and video preparation. */
export function readBookShotChapter(chapter: BookShotChapter, showScenes = chapter.blocks.storyboardScenes === true, preceding = 0) {
  const modules = bookManuscriptModules(chapter.blocks);
  const nodes = new Map<string, { shot?: string; scene?: string }>();
  const shots = new Map<string, Shot>();
  const wholeAudio: MediaAudio[] = [];
  const context: { scene?: string; text: string }[] = [];
  const owned = new Map<string, { content: string[]; notes: string[]; dialogue: string[]; voiceSection?: boolean; pendingField?: ShotField }>();
  modules.forEach(({ row, text, audio, image, dialogue }) => {
    if (!row) { if (audio) wholeAudio.push(audio); return; }
    const parent = row.parentId ? nodes.get(row.parentId) : undefined;
    const owner = {
      shot: row.format === "shot" ? row.id : parent?.shot,
      scene: row.format === "scene" ? row.id : parent?.scene,
    };
    nodes.set(row.id, owner);
    if (row.format === "shot") {
      owned.set(row.id, { content: [], notes: [], dialogue: [] });
      shots.set(row.id, { id: `book-shot-${chapter.id}-${row.id}`, chapterId: chapter.id, moduleId: row.id, title: text, targets: {},
        sourceModuleIds: [], text: "", notes: "", dialogueText: "", images: [], audio: [] });
    }
    const shot = owner.shot ? shots.get(owner.shot) : undefined;
    if (!shot) {
      if (audio) wholeAudio.push(audio);
      else if (!image && text.trim()) {
        const note = row.format === "scene" && !showScenes ? sceneSetting(text) : text;
        if (note) context.push({ scene: owner.scene, text: note });
      }
      return;
    }
    shot.sourceModuleIds.push(`${chapter.id}:${row.id}`);
    if (image) shot.images.push(image);
    else if (audio) shot.audio.push(audio);
    else {
      const part = owned.get(shot.moduleId)!;
      part.content.push(text);
      if (row.videoRole === "dialogue" && text.trim()) {
        if (part.pendingField === "voice" || !shot.targets.voice) shot.targets.voice = { moduleId: row.id, offset: 0 };
        part.pendingField = undefined;
      } else if (row.format === "text") {
        let start = 0;
        for (const line of text.split("\n")) {
          const field = readShotField(line);
          if (field) shot.targets[field.kind] ??= {
            moduleId: row.id, offset: start + (field.inline ? Math.max(0, line.indexOf(field.inline)) : 0),
          };
          if (line.trim()) {
            if (!field && part.pendingField) shot.targets[part.pendingField] = { moduleId: row.id, offset: start };
            part.pendingField = field && !field.inline ? field.kind : undefined;
          }
          start += line.length + 1;
        }
      }
      if (row.format !== "shot") {
        for (const line of text.split("\n")) {
          const field = readShotField(line);
          // Explicit dialogue classification wins, including lines like “音乐：我记得那天。”
          if (dialogue !== undefined && field?.kind !== "voice") {
            if (line.trim()) part.dialogue.push(spokenBookDialogue(line));
          } else if (field?.kind === "voice") {
            part.voiceSection = !field.inline;
            const heading = line.split(/[：:]/,1)[0].replace(/\*\*/g,"").trim();
            if (/[｜|（(]/.test(heading)) part.notes.push(heading);
            if (field.inline) part.dialogue.push(spokenBookDialogue(line) === line ? field.inline : spokenBookDialogue(line));
          } else if (!field && part.voiceSection && line.trim() && !/^\s*(?:#|\*\*)/.test(line)) {
            part.dialogue.push(line);
          } else {
            if (line.trim()) part.voiceSection = false;
            part.notes.push(line);
          }
        }
      } else if (dialogue !== undefined) part.dialogue.push(dialogue);
    }
  });
  for (const shot of shots.values()) {
    const scene = nodes.get(shot.moduleId)?.scene;
    const common = context.filter(row => !row.scene || row.scene === scene).map(row => row.text);
    const part = owned.get(shot.moduleId)!;
    shot.text = [...common, ...part.content].join("\n").trim();
    shot.notes = [...common, ...part.notes].join("\n");
    shot.dialogueText = part.dialogue.join("\n");
  }
  const ordered = [...shots.values()];
  const links = bookShotLinks(ordered.map(shot=>({
    id:shot.moduleId, title:shot.title, scene:nodes.get(shot.moduleId)?.scene,
    ...shotMediaDirections(shotDirections(owned.get(shot.moduleId)!.notes.join("\n")), ""),
    images:shot.images.map(i=>i.url),
  })),preceding);
  for (const shot of ordered) {
    const link = links.get(shot.moduleId);
    if (link) shot.link = link;
  }
  return { shots: ordered, wholeAudio, nodes, texts: modules.map(m => m.text) };
}

/** Keep unlabelled notes intact. Speech and media references are supplied separately. */
export function shotDirections(notes: string) {
  const sections: Record<Exclude<ShotField, "voice"> | "other" | "audio", string[]> = {
    picture: [], motion: [], sound: [], music: [], emotion: [], subtitle: [], source: [], timing: [], other: [], audio: [],
  };
  let continuation: keyof typeof sections = "other";
  for (const raw of notes.split("\n")) {
    const line = raw.trim();
    if (!line) { if (continuation !== "motion") continuation = "other"; continue; }
    const clean = line.replace(/^#{1,6}\s+/, "").replace(/\*\*/g, "");
    const colon = clean.search(/[：:]/);
    const field = readShotField(raw);
    const timeLine: boolean = /^(?:分镜草案\s*·|\d+(?:\.\d+)?\s*秒\s*[，,。])/.test(clean) && continuation === "other";
    const section: keyof typeof sections = field?.kind === "voice" || timeLine ? "timing" : field?.kind ?? "other";
    if (section !== "other" || /^(?:#{1,6}\s|\*\*[^*：:]+\*\*\s*[:：]?\s*$)/u.test(line)) continuation = "other";
    const heading = field && !field.inline;
    const role = section === "other" ? continuation : section;
    let writing = field ? clean : line;
    if (role === "sound" && !heading) {
      const { sound, speech } = splitSoundSpeechTiming(field?.inline || writing);
      if (speech) {
        sections.timing.push("旁白｜" + speech);
        writing = field ? (sound ? clean.slice(0, colon + 1) + sound : "") : sound;
      }
    }
    if (writing && (!heading || section === "picture" || /[｜|（(]/.test(clean))) sections[role].push(writing);
    if (writing && (role === "sound" || role === "music")) sections.audio.push(writing);
    if (field && (heading || ["picture", "motion", "music", "sound", "emotion", "subtitle"].includes(field.kind))) continuation = section;
  }
  return sections;
}

export function shotMediaDirections(dirs: ReturnType<typeof shotDirections>, title: string) {
  const pictureField = dirs.picture.length > 0;
  const visualLines = pictureField ? dirs.picture.filter(line => !/^(?:素材待准备|参考素材|屏幕文字|字幕)\s*[：:]\s*\S/u.test(line)) : dirs.other;
  const directions = pictureDirections(visualLines.join("\n") || (pictureField ? "" : title));
  return { picture: directions.picture, video: dirs.motion.join("\n") || directions.motion };
}
