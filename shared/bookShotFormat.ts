import { readBookAudio } from "./bookAudioBlock";
import { readBookImage } from "./bookImageBlock";
import { splitBookVoiceLine } from "./bookSound";
import { validWritingStyle, writingModuleTexts, type BookWritingStyle } from "./bookWritingStyle";

const legacyHeadings = ["时长", "画面提示词", "运镜提示词", "旁白", "音效提示词", "出处与创作处理"];
const shotHeadings = ["时长", "情绪走向", "画面描述", "视频", "旁白", "音效", "音乐", "出处与创作处理"];
export const shotFieldPolicy = {
  picture: "画面描述只写暂停任一帧能看见的内容。页码与材料列入出处。物件上实际印着的数字、字样可保留。",
  motion: "切镜、移动、人物在时间中的动作、起止秒数、持续时长归视频。",
  subtitle: "字幕只收实际上屏的文字。淡入、停留、消失的时间写在字幕栏的时间说明，不能成为字幕正文。",
  voice: "台词收实际要说的原话；何时开口、收住、停顿写在台词的时间说明。",
  sound: "音效收现场声源、远近、音量变化和起止。",
  music: "音乐收配器、节奏和进入、让位、结束的时点。",
  timing: "整片试排、待配音后调整等说明归时长与节奏。",
} as const;
export const shotFormatGuide = `所有故事的分镜沿用 统一镜头制作单。制作分为画面、视频、音乐、旁白四类。字幕归视频的上屏文字，现场音效独立标在声音部分，勿让配乐模型演奏音效。视频标注已明确的本镜总时长，绝不以全片切入秒数推算；资料缺失且影响成品时，只问一个具体问题。每镜用简短标题，可用栏目为${shotHeadings.join("、")}。按作者指定的栏目与时长写，允许暂缺。先从作者意图和作品情绪找出这一镜在全片变化中的位置，不把整条情绪弧重复塞进每一镜。把感受落实到本镜同一时间轴上的具体选择：画面描述只写一帧可见的人物姿态、相对位置、构图、材质、光色；视频写主体怎么动、机位、景别、何时起动和停住；音效写场内实际声源、远近、出现和消退；音乐单写配器、节奏密度、何时进入、让位或停奏。用同一个可见动作或停顿对齐各轨，勿把时间、运镜、台词或声音放进图片提示词。栏目归属规则：${Object.values(shotFieldPolicy).join("")}各轨可留白；保留指定的固定机位、原图、静音、原句及声画反差。不得为表现情绪增添无依据的人或事件。把文字资料拍成现场。先提取人物、事件和可核实的处境，再为观众选择一个具体的动作、一处空间或一个听得见的变化。旁白用讲述者自己的口吻接住画面。书名、页码、图注和引文归查证资料。只有作者明确要拍某件文献、阅读行为或呈现原句时，才把相应的纸面或文字写进成片。旧稿里曾经拍过铅字、翻页或朗读，只代表旧版拍法，修订时服从作者本轮的取舍。字幕单列为屏幕文字。旁白或台词的朗读原句单列，开口时间、语气和留白写在标题或时长说明里。默认只按镜号组织，地点和环境写进画面说明。只有作者明确要求分场时才给出场号与标题。整理已有整片稿时，按当前主稿逐镜保留数量、顺序、台词和素材；单镜候选须经作者采用才并入。事实、作者原话和创作建议分别标清，缺少的制作信息标待定。`;
/** Read outline choices only from author instructions. A setting or a transition is ordinary shot content. */
export function requestedSceneGrouping(instruction: string): boolean | undefined {
  const clauses = instruction.replace(/[“「『"][^”」』"]*[”」』"]/gu, "").split(/[，,。；;！!\n]+/u);
  let choice: boolean | undefined;
  for (const part of clauses) {
    const text = part.trim();
    if (!text || /[？?]|(?:什么|为什么|怎么|要不要|是否)|^(?:如果|假如|据说|他说|她说|书里写|原文|片中写)/u.test(text)) continue;
    if (/(?:不(?:要|用|需(?:要)?)?|别|取消|隐藏|去掉|关闭)(?:再|使用|显示|划分|划|按|设置|设|拆|列|写|加|成|分|这个|有|提|\s)*(?:场次|场号|场(?!景|地|合|面|内|外))|只(?:用|按|要|看|显示|保留|写|列)(?:一个个|连续)?镜头|(?:no|without) scene (?:groups?|headings?|numbers?)|shots? only/iu.test(text)) choice = false;
    else if (/(?:按|逐|分成|分为|划成|拆成|拆为|分作)(?:[零一二三四五六七八九十\d]+个?)?场(?!景|地|合|面|内|外)|(?:请|要|用|做|保留|显示|开启|加上|标出|写出|需要|采用|使用|可以|开始|帮我|先|来)分场|^分场(?:吧|显示|写|来写|整理|列|排|制作|生成|分镜|$)|按场景(?:来)?(?:分组|分镜|划分|分场|组织镜头)|(?:显示|展示|保留|加上|列出|打开|标明|标出|写出|标注)(?:每场的)?场(?:号|次|标题)|^第\s*[零一二三四五六七八九十\d]+\s*场[\s：:]|(?:group|organize|organise|divide|split).{0,30}(?:by|into) scenes?|show scene (?:groups?|headings?|numbers?)/iu.test(text)) choice = true;
  }
  return choice;
}

/** A legacy heading can also describe a real setting needed by its shots. */
export function sceneSetting(text: string) {
  return text.trim().replace(/^(?:第\s*[零〇一二三四五六七八九十百\d]+\s*场|scene\s+\d+)(?:[\s：:｜|、—–-]+|$)/iu, "").trim();
}

/** Short display commands reuse saved messages so refreshing restores the same view. */
export function sceneOutlineViewRequest(text: string) {
  return /^(?:请|帮我)?(?:切换到|改成)?(?:按场(?:次)?(?:显示|展示|查看|看)(?:分镜|镜头)?|显示(?:分场|场次|场号)|不分场|只(?:显示|看|列|保留)镜头|隐藏场(?:次|号)?)[吧。.!！\s]*$/u.test(text.trim())
    ? requestedSceneGrouping(text) : undefined;
}

export function storyboardUsesScenes(request: string, conversation: ReadonlyArray<{role: string; content: string}> = [], previous = false): boolean {
  const current = requestedSceneGrouping(request);
  if (current !== undefined) return current;
  for (let i = conversation.length - 1; i >= 0; i--) {
    if (conversation[i].role !== "user") continue;
    const choice = requestedSceneGrouping(conversation[i].content);
    if (choice !== undefined) return choice;
  }
  return previous;
}

const blankBody = (labels: string[]) => ["镜头标题", ...labels.map(label => label === "旁白" ? "旁白\n" : label + "：")].join("\n");
export const blankShotManuscript = "第 1 镜｜" + blankBody(shotHeadings);
export function isBlankShotTemplate(body: string) {
  return [shotHeadings, legacyHeadings].some(labels => body.trim() === blankBody(labels));
}
const shotHeading = /^(?:#{1,6}\s*)?(?:\*\*)?(?:第\s*[〇零一二三四五六七八九十百\d]+\s*镜(?:头)?|镜头\s*[〇零一二三四五六七八九十百\d]+)(?:\s*[｜|·:：、—-]\s*|\s+|$)/u;
export type ShotField = "picture" | "motion" | "voice" | "sound" | "music" | "emotion" | "subtitle" | "source" | "timing";
const fields: Array<[ShotField, RegExp]> = [
  ["picture", /^(开场画面|结束画面|画面|画面与素材|素材待准备|参考画面|参考素材)(提示词|要求|描述|说明|建议)?$/],
  ["subtitle", /^(屏幕文字|字幕)(提示词|要求|说明)?$/],
  ["emotion", /^(情绪走向|情绪变化|情绪节拍|情绪)$/],
  ["motion", /^(视频|画面运动|运镜|镜头运动|动作|运动|相机运动)(提示词|要求|说明|建议)?$/],
  ["music", /^(音乐|配乐|背景音乐)(提示词|要求|说明|建议|设计)?$/],
  ["sound", /^(声音|音效|现场音效|环境声|环境音|背景音|声效)(提示词|要求|说明|建议|设计)?$/],
  ["voice", /^(旁白|台词|画外音|对白|台词或旁白|台词\s*[/／]\s*旁白)$/],
  ["source", /^(出处(?:与|和|及)?(?:创作)?处理|出处|史料依据|资料来源|创作处理)$/],
  ["timing", /^(已确认视频时长|视频时长|本镜时长|时长|时间范围|节奏与时长|时长与节奏)$/],
];
export function readShotField(raw: string) {
  const line = raw.trim().replace(/\\$/, "").trimEnd().replace(/^#{1,6}\s+/, "").replace(/\*\*/g, "");
  const colon = line.search(/[：:]/);
  const label = (colon < 0 ? line : line.slice(0, colon)).split(/[｜|]/)[0].replace(/[（(].*?[）)]$/, "").trim();
  const kind = fields.find(([, pattern]) => pattern.test(label))?.[0];
  return kind ? { kind, inline: colon < 0 ? "" : line.slice(colon + 1).trim() } : undefined;
}

/** Some older scripts introduced the next spoken line at the end of the sound cue. */
export function splitSoundSpeechTiming(line: string) {
  const cue = /(?:^|[，,；;]\s*)((?:旁白|台词|对白)?\s*(?:约\s*)?第\s*[\d.一二三四五六七八九十]+\s*秒(?:钟)?(?:前|时)?\s*(?:旁白|台词|对白)?\s*(?:开口|开始说话|开始说|收住))[：:。\s]*$/u.exec(line);
  if (!cue) return { sound: line, speech: "" };
  const sound = line.slice(0, cue.index).trim().replace(/(声)[中里]$/u, "$1");
  return { sound, speech: cue[1].trim() };
}

/** An imported trial becomes ordinary editable book modules. Existing source IDs survive promotion. */
export function structureShotDraft(body: string, style: BookWritingStyle | undefined, newId: () => string, fallbackTitle: string) {
  if (style && (!validWritingStyle(body, style) || style.some(r => r.format !== "text" || r.parentId))) return null;
  const texts = writingModuleTexts(body, style);
  const row = (): BookWritingStyle[number] => ({ id: newId(), format: "text", parentId: null, collapsed: false });
  const rows = style?.map(r => ({ ...r })) ?? texts.map(row);
  let first = texts.findIndex(t => t.trim());
  if (first >= 0 && shotHeading.test(texts[first].trim())) {
    const title = texts[first].trim().replace(shotHeading, "").replace(/\*\*$/, "").trim();
    if (title) texts[first] = title;
  } else {
    texts.unshift(fallbackTitle);
    rows.unshift(row());
    first = 0;
  }
  const root = rows[first];
  root.format = "shot";
  root.collapsed = false;
  let speech = false;
  for (let i = first + 1; i < rows.length; i++) {
    const r = rows[i], text = texts[i];
    r.parentId = root.id;
    const field = readShotField(text.split("\n")[0]);
    if (field) speech = field.kind === "voice" && !field.inline;
    else if (/^\s*(?:#{1,6}\s|\*\*)/.test(text)) speech = false;
    if (readBookAudio(text) || readBookImage(text)) continue;
    if (!field && speech) r.videoRole = "dialogue";
    if (field?.kind === "voice" && field.inline && !/^(?:第\s*\d|\d+\s*秒|约第|平静地说|只留|无旁白|无[。.]?$)/.test(field.inline)) {
      r.videoRole = "dialogue";
      // Keep the heading (including performance cues) apart from the words to speak.
      if (!text.includes("\n") && !/^[「“"]/.test(field.inline)) {
        const colon = text.search(/[：:]/);
        const heading = text.slice(0, colon).replace(/\*\*/g, "").trim();
        rows.splice(i, 0, { ...row(), parentId: root.id });
        texts.splice(i, 1, heading, field.inline);
        i++;
      }
    }
  }
  return { body: texts.join("\n"), writingStyle: rows };
}

/** A request to list the existing film is a read operation. */
export function listsWholeStoryboard(message: string) {
  const request = message.trim().replace(/[“「『"][^”」』"]*[”」』"]/gu, "");
  if (/[?？]|(?:不必|不要|不用|别|如果|假如|怎么|能否|修改|改写|重写|新写|生成|渲染|删|替换|补写|加一镜)/u.test(request)) return false;
  return /(?:整理|列出|列一下|列一遍|列给我|罗列|查看|看看|核对|列出来)/u.test(request) &&
    /(?:全部|所有|整片|整部|全片|完整|全套).{0,18}(?:镜头|分镜)|(?:镜头|分镜).{0,10}(?:全部|所有|整理全)/u.test(request);
}

/** A one-shot working version is separate from the continuous chapters of a full film. */
export function bookProductionChapters<T extends { id: number; blocks: { body: string; shotTextOrigin?: { shotId: string } } }>(chapters: T[], chapterId?: number): T[] {
  const selected = chapters.find(c => c.id === chapterId);
  if (chapterId !== undefined && !selected) return [];
  if (selected?.blocks.shotTextOrigin) return [selected];
  const main = chapters.filter(c => !c.blocks.shotTextOrigin);
  if (main.some(c => c.blocks.body.trim())) return main;
  const trials = chapters.filter(c => c.blocks.shotTextOrigin);
  return !selected && trials.length === 1 ? trials : main;
}

/** Some older conversions put an entire shot, including quoted speech, in its heading. */
export function expandShotDescriptions(body: string, style: BookWritingStyle, newId: () => string) {
  const texts = writingModuleTexts(body, style);
  const owners = new Map<string, string | undefined>();
  const hasNotes = new Set<string>();
  for (const [i, row] of style.entries()) {
    const owner = row.format === "shot" ? row.id : row.parentId ? owners.get(row.parentId) : undefined;
    owners.set(row.id, owner);
    if (owner && row.format === "text" && texts[i].trim() && !readBookImage(texts[i]) && !readBookAudio(texts[i])) hasNotes.add(owner);
  }
  const lines: string[] = [], writingStyle: BookWritingStyle = [];
  for (const [i, row] of style.entries()) {
    const raw = texts[i];
    writingStyle.push(row); lines.push(raw);
    if (row.format !== "shot" || row.videoRole || hasNotes.has(row.id) || raw.includes("\n")) continue;
    const mixed = splitBookVoiceLine(raw);
    if (!mixed && (raw.length < 32 || !/[。！？]/.test(raw))) continue;
    const first = (mixed?.spoken ?? raw).split(/[，。！？：:「“]/u).find(s => s.trim())?.trim();
    if (!first) continue;
    lines[lines.length - 1] = [...first].slice(0, 32).join("");
    const child = (text: string, voice = false) => {
      lines.push(text); writingStyle.push({ id: newId(), format: "text", collapsed: false, parentId: row.id, ...(voice ? { videoRole: "dialogue" as const } : {}) });
    };
    if (mixed) {
      child(mixed.speech, true);
      if (mixed.direction.trim()) child("画面提示词：" + mixed.direction);
    } else child("画面提示词：" + raw);
  }
  return { body: lines.join("\n"), writingStyle };
}
