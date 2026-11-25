import { readBookAudio } from "./bookAudioBlock";
import { readShotField, sceneSetting, type ShotField } from "./bookShotFormat";
import { readBookImage } from "./bookImageBlock";
import { spokenBookDialogue } from "./bookSound";
import { writingModuleTexts, type BookWritingStyle } from "./bookWritingStyle";

export type BookShotChapter = { id: number; blocks: { body: string; storyboardScenes?: boolean; writingStyle?: BookWritingStyle } };
type MediaAudio = NonNullable<ReturnType<typeof readBookAudio>>;
type MediaImage = NonNullable<ReturnType<typeof readBookImage>>;
type Shot = {
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
export function readBookShotChapter(chapter: BookShotChapter, showScenes = chapter.blocks.storyboardScenes === true) {
  const modules = bookManuscriptModules(chapter.blocks);
  const nodes = new Map<string, { shot?: string; scene?: string }>();
  const shots = new Map<string, Shot>();
  const wholeAudio: MediaAudio[] = [];
  const context: { scene?: string; text: string }[] = [];
  const owned = new Map<string, { content: string[]; notes: string[]; dialogue: string[]; pendingField?: ShotField }>();
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
      if (row.videoRole === "dialogue" && text.trim()) shot.targets.voice ??= { moduleId: row.id, offset: 0 };
      else if (row.format === "text") {
        let start = 0;
        for (const line of text.split("\n")) {
          const field = readShotField(line);
          if (field && field.kind !== "voice") shot.targets[field.kind] ??= {
            moduleId: row.id, offset: start + (field.inline ? Math.max(0, line.indexOf(field.inline)) : 0),
          };
          if (line.trim()) {
            if (!field && part.pendingField) shot.targets[part.pendingField] = { moduleId: row.id, offset: start };
            part.pendingField = field && !field.inline && field.kind !== "voice" ? field.kind : undefined;
          }
          start += line.length + 1;
        }
      }
      if (dialogue !== undefined) part.dialogue.push(dialogue);
      else if (row.format !== "shot" && text.trim()) part.notes.push(text);
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
  return { shots: [...shots.values()], wholeAudio, nodes, texts: modules.map(m => m.text) };
}

/** Keep unlabelled notes intact. Speech and media references are supplied separately. */
export function shotDirections(notes: string) {
  const sections = { picture: [] as string[], motion: [] as string[], sound: [] as string[], source: [] as string[], timing: [] as string[], other: [] as string[] };
  let continuation: keyof typeof sections = "other";
  for (const raw of notes.split("\n")) {
    const line = raw.trim();
    if (!line) { continuation = "other"; continue; }
    const clean = line.replace(/^#{1,6}\s+/, "").replace(/\*\*/g, "");
    const colon = clean.search(/[：:]/);
    const field = readShotField(raw);
    const timeLine: boolean = /^(?:分镜草案\s*·|\d+(?:\.\d+)?\s*秒\s*[，,。])/.test(clean) && continuation === "other";
    const section: keyof typeof sections = field?.kind === "voice" || timeLine ? "timing" : field?.kind ?? "other";
    if (section !== "other" || colon !== -1 || /^#|^\*\*/.test(line)) continuation = "other";
    const heading = field && !field.inline;
    if (!heading || /[｜|（(]/.test(clean)) sections[section === "other" ? continuation : section].push(field ? clean : line);
    if (heading) continuation = section;
  }
  return sections;
}
