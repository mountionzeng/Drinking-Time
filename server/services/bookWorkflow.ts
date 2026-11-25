import { beginLiveManuscript } from "./liveManuscript";
import { bookProductionChapters, expandShotDescriptions, sceneSetting, shotFormatGuide, storyboardUsesScenes } from "../../shared/bookShotFormat";
import { needsFilmSubject } from "../../shared/creativeConversation";
import { readVideoWorkflow } from "../../shared/videoWorkflow";
import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  currentManuscript,
  manuscriptLabel,
  readBookWorkflow,
  versionReference,
  type BookWorkflowState,
  type CreationIntent,
  type ManuscriptContent,
  type ManuscriptKind,
  type ManuscriptReference,
  type ManuscriptSource,
  type VersionActor,
} from "../../shared/bookWorkflow";
import {
  validWritingStyle,
  writingModuleTexts,
  type BookWritingStyle,
} from "../../shared/bookWritingStyle";
import { readBookImage } from "../../shared/bookImageBlock";
import { readBookAudio } from "../../shared/bookAudioBlock";
import { getStoryById } from "../repositories/stories";
import { listChapters } from "../repositories/chapters";
import {
  bookEntry,
  manuscriptRows,
  mutateBookWorkflow,
} from "../repositories/bookWorkflow";
import { quoteStoryboardCompute, runPublishingVideoStoryboardTextCompute } from "./publishingVideoStoryboard";

type Owner = { storyId: number; userId: number };
type ActorInput = Owner & { actor: VersionActor };
const conflict = (message = "稿件已有新修改，请保存并重新核对后继续。") =>
  new TRPCError({ code: "CONFLICT", message });
const bad = (message: string) =>
  new TRPCError({ code: "BAD_REQUEST", message });
export {
  manuscriptContents,
  manuscriptFingerprint,
} from "./manuscriptSnapshot";
import {
  manuscriptContents,
  manuscriptFingerprint,
} from "./manuscriptSnapshot";
function appendVersion(
  state: BookWorkflowState,
  input: {
    id: string;
    kind: ManuscriptKind;
    chapters: ManuscriptContent[];
    intent: CreationIntent;
    actor: VersionActor;
    summary: string;
    source?: ManuscriptSource;
    aiAssisted?: boolean;
  }
) {
  if (!input.chapters.length) throw bad("请先写入稿件内容");
  if (state.versions.length >= 200)
    throw bad("版本记录已达容量上限，历史仍保留，请新建作品继续。");
  const version = {
    id: input.id,
    kind: input.kind,
    number:
      Math.max(
        0,
        ...state.versions.filter(v => v.kind === input.kind).map(v => v.number)
      ) + 1,
    name: input.intent.purpose.slice(0, 100),
    createdAt: Date.now(),
    intent: input.intent,
    author: input.actor,
    confirmedBy: input.actor,
    editedBy: input.actor,
    aiAssisted:
      input.aiAssisted ?? input.chapters.some(c => c.blocks.containsAiText),
    summary: input.summary,
    parentId: state.current[input.kind],
    source: input.source,
    chapters: manuscriptContents(input.chapters),
    fingerprint: manuscriptFingerprint(input.chapters),
  };
  state.versions.push(version);
  state.current[input.kind] = version.id;
  return version;
}
export async function getBookWorkflow(input: Owner) {
  const story = await getStoryById(input.storyId, input.userId);
  if (!story) throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在" });
  const state = readBookWorkflow(
    (story.body as Record<string, unknown>)?.bookWorkflow
  );
  const videoVersions=readVideoWorkflow((story.body as Record<string,unknown>)?.videoWorkflow).versions;
  for(const draft of state.conversions) if(draft.source.kind==="video") {
    const version=videoVersions.find(v=>v.id===(draft.source.kind==="video"?draft.source.videoVersionId:undefined)||v.id===draft.source.id);
    if(version)draft.source.number=version.number;
  }
  const rows = await listChapters(input.storyId, input.userId, "all");
  const drafts = Object.fromEntries(
    (["text", "storyboard"] as const).map(kind => {
      const chapters = manuscriptRows(rows, kind),
        current = currentManuscript(state, kind);
      const fingerprint = manuscriptFingerprint(chapters);
      return [
        kind,
        {
          count: chapters.length,
          fingerprint,
          dirty: current?.fingerprint !== fingerprint,
          version: current ? versionReference(current) : null,
        },
      ];
    })
  ) as Record<
    ManuscriptKind,
    {
      count: number;
      fingerprint: string;
      dirty: boolean;
      version: ManuscriptReference | null;
    }
  >;
  return {
    state,
    drafts,
    preferredKind: bookEntry(rows, state).kind,
  };
}
export async function saveManuscriptVersion(
  input: ActorInput & {
    id: string;
    kind: ManuscriptKind;
    intent: CreationIntent;
    summary: string;
    expectedFingerprint: string;
  }
) {
  return mutateBookWorkflow(input, ({ state, rows }) => {
    const existing = state.versions.find(v => v.id === input.id);
    if (existing) {
      if (
        existing.kind !== input.kind ||
        existing.fingerprint !== input.expectedFingerprint ||
        JSON.stringify(existing.intent) !== JSON.stringify(input.intent) ||
        existing.summary !== input.summary
      )
        throw conflict("请求编号已被其他版本使用");
      return { result: existing };
    }
    const chapters = manuscriptRows(rows, input.kind);
    if (manuscriptFingerprint(chapters) !== input.expectedFingerprint)
      throw conflict();
    return {
      result: appendVersion(state, {
        ...input,
        chapters,
        source: currentManuscript(state, input.kind)?.source,
      }),
    };
  });
}
export async function restoreManuscriptVersion(
  input: ActorInput & {
    id: string;
    versionId: string;
    expectedFingerprint: string;
  }
) {
  return mutateBookWorkflow(input, ({ state, rows }) => {
    const existing = state.versions.find(v => v.id === input.id);
    if (existing) {
      if (existing.source?.id !== input.versionId) throw conflict();
      return { result: existing };
    }
    const previous = state.versions.find(v => v.id === input.versionId);
    if (!previous) throw bad("版本不存在");
    const chapters = manuscriptRows(rows, previous.kind);
    if (manuscriptFingerprint(chapters) !== input.expectedFingerprint)
      throw conflict();
    const current = currentManuscript(state, previous.kind);
    if (chapters.length && current?.fingerprint !== input.expectedFingerprint)
      appendVersion(state, {
        ...input,
        id: randomUUID(),
        kind: previous.kind,
        intent: current?.intent ?? previous.intent,
        chapters,
        summary: "恢复历史前保留的草稿",
      });
    const version = appendVersion(state, {
      ...input,
      kind: previous.kind,
      chapters: previous.chapters,
      intent: previous.intent,
      source: versionReference(previous),
      summary: `基于${manuscriptLabel(previous.kind)} V${previous.number}恢复`,
      aiAssisted: previous.aiAssisted,
    });
    return {
      result: version,
      replace: { kind: previous.kind, chapters: version.chapters },
    };
  });
}

const modelSchema = z.object({
  chapters: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        modules: z
          .array(
            z.preprocess(
              value => {
                // Referenced media supplies its own content; no generated text is needed.
                if (value && typeof value === "object" && !Array.isArray(value)) {
                  const module = value as Record<string, unknown>;
                  const media = typeof module.media === "string" && /^(0|[1-9]\d*)$/.test(module.media)
                    ? Number(module.media)
                    : module.media;
                  if (module.format === "text" && media !== undefined && module.text === undefined)
                    return { ...module, media, text: "" };
                  if (media !== module.media) return { ...module, media };
                }
                return value;
              },
              z.object({
                format: z.enum(["text", "heading1", "heading2", "scene", "shot"]),
                text: z.string().max(12000),
                parent: z.number().int().nonnegative().nullable(),
                media: z.number().int().nonnegative().optional(),
                dialogue: z.boolean().optional(),
              })
            )
          )
          .min(1)
          .max(1000),
      })
    )
    .min(1)
    .max(100),
});
// Older providers may still return scene wrappers. Carry their setting into the
// shots they contained. Scene numbers alone have no production content.
function normalizeStoryboardParents(modules: z.infer<typeof modelSchema>["chapters"][number]["modules"], showScenes: boolean) {
  const result: typeof modules = [];
  let sceneParent: number | null = null;
  let setting: string | undefined;
  let usedSetting = false;
  let shot: number | null = null;
  function startShot(title: string) {
    shot = result.length;
    result.push({ format: "shot", text: title, parent: sceneParent });
    if (!showScenes && setting) result.push({ format: "text", text: setting, parent: shot });
    usedSetting = true;
  }
  function finishSetting() {
    if (setting && !usedSetting) startShot("镜头");
    setting = undefined;
    sceneParent = null;
  }
  for (const [index, module] of modules.entries()) {
    if (module.parent !== null && module.parent >= index) throw bad("转换稿层级顺序无效");
    if (module.format === "scene") {
      if (module.parent !== null || module.media !== undefined || module.dialogue) throw bad("分镜资料归属不明确");
      finishSetting();
      setting = sceneSetting(module.text);
      if (showScenes) {
        sceneParent = result.length;
        result.push(module);
      }
      shot = null;
      usedSetting = false;
      continue;
    }
    if (module.format === "shot") {
      if (module.parent === null) {
        if (usedSetting) finishSetting();
      } else if (setting === undefined) throw bad("镜头应独立排列");
      startShot(module.text);
      if (module.media !== undefined) result.push({ format: "text", text: "", media: module.media, parent: shot });
      continue;
    }
    if (module.format !== "text") throw bad("转换稿件类型不匹配");
    if (shot === null) {
      if (setting === undefined && module.media === undefined) throw bad("分镜正文需要归属镜头");
      startShot("镜头");
    }
    result.push({ ...module, parent: shot });
  }
  finishSetting();
  return result;
}
const mediaText = (text: string) =>
  Boolean(readBookImage(text) || readBookAudio(text));
export function conversionSource(chapters: ManuscriptContent[]) {
  return chapters.map(chapter => {
    const modules = writingModuleTexts(
      chapter.blocks.body,
      chapter.blocks.writingStyle
    );
    if (
      chapter.blocks.writingStyle &&
      !validWritingStyle(chapter.blocks.body, chapter.blocks.writingStyle)
    )
      throw bad("稿件结构未完整保存");
    if (
      modules.some(text => !mediaText(text) && text.split("\n").some(mediaText))
    )
      throw bad("图片或声音与正文混在同一模块，请先将媒体放为独立模块再转换。");
    const urls = new Set(
      modules.flatMap(text => {
        const image = readBookImage(text);
        return image ? [image.url] : [];
      })
    );
    if (
      chapter.layout?.pages.some(page =>
        page.modules.some(
          module => module.kind === "image" && !urls.has(module.imageUrl)
        )
      )
    )
      throw bad(
        "旧排版还有独立图片，请先放入对应正文位置，确保转换后素材归属明确。"
      );
    return { title: chapter.title, modules, media: modules.filter(mediaText) };
  });
}
export function applyConversion(
  source: ManuscriptContent[],
  target: ManuscriptKind,
  value: unknown,
  showScenes = false
): ManuscriptContent[] {
  const parsed = modelSchema.parse(value),
    originals = conversionSource(source);
  if (parsed.chapters.length !== source.length)
    throw bad("转换遗漏了源章节，原稿仍保留");
  return parsed.chapters.map((chapter, index) => {
    const media = originals[index].media,
      used = new Set<number>();
    const style: BookWritingStyle = [],
      texts: string[] = [];
    const modules = target === "storyboard" ? normalizeStoryboardParents(chapter.modules, showScenes) : chapter.modules;
    const originalShots = source[index].blocks.writingStyle?.filter(r => r.format === "shot");
    const sameTrialShot = source[index].blocks.shotTextOrigin && originalShots?.length === 1 && modules.filter(m => m.format === "shot").length === 1
      ? originalShots[0].id : undefined;
    modules.forEach((module, i) => {
      if (
        (target === "text" && ["scene", "shot"].includes(module.format)) ||
        (target === "storyboard" &&
          ["heading1", "heading2"].includes(module.format))
      )
        throw bad("转换稿件类型不匹配");
      let text = module.text;
      if (module.media !== undefined) {
        if (
          !media[module.media] ||
          used.has(module.media) ||
          module.format !== "text"
        )
          throw bad("转换中的素材归属无效");
        used.add(module.media);
        text = media[module.media];
      } else if (text.split("\n").some(mediaText) || /!\[[^\]]*\]\(/.test(text))
        throw bad("转换不能添加未经选择的媒体");
      if (module.parent !== null && module.parent >= i)
        throw bad("转换稿层级顺序无效");
      const parent = module.parent === null ? null : style[module.parent];
      if (
        target === "storyboard" &&
        (module.format === "scene" ? !showScenes || parent !== null : module.format === "shot" ? parent !== null && parent?.format !== "scene" : parent?.format !== "shot")
      )
        throw bad("请检查镜头层级，台词和素材需要归属镜头");
      style.push({
        id: module.format === "shot" && sameTrialShot ? sameTrialShot : randomUUID(),
        format: module.format,
        parentId: parent?.id ?? null,
        collapsed: false,
        lineCount: text.split("\n").length,
        ...(module.dialogue && module.media === undefined
          ? { videoRole: "dialogue" as const }
          : {}),
      });
      texts.push(text);
    });
    if (used.size !== media.length)
      throw bad("转换遗漏了图片或声音，原稿仍保留");
    const { body, writingStyle } = target === "storyboard"
      ? expandShotDescriptions(texts.join("\n"), style, randomUUID)
      : { body: texts.join("\n"), writingStyle: style };
    if (
      body.length > 200000 ||
      !validWritingStyle(body, writingStyle) ||
      (target === "storyboard" && !style.some(row => row.format === "shot"))
    )
      throw bad("转换稿结构不完整");
    const { draftMirror, manuscriptArchived, storyboardScenes, ...blocks } = source[index].blocks;
    return {
      title: chapter.title,
      layout: null,
      blocks: {
        ...blocks,
        body,
        writingStyle,
        blockIds: body
          .split("\n")
          .filter(line => line.trim())
          .map(() => randomUUID()),
        manuscriptKind: target,
        ...(target === "storyboard" && showScenes ? { storyboardScenes: true } : {}),
        containsAiText: true,
      },
    };
  });
}
type FilmInput = {
  chapterId?: number; request: string; target?: ManuscriptKind;
  quoteFingerprint?: string;
  conversation: Array<{ role: "user" | "assistant"; content: string }>;
};

function useScenesForDraft(request: string, conversation: FilmInput["conversation"] | undefined, chapters: ManuscriptContent[]) {
  return storyboardUsesScenes(request, conversation, chapters.some(c => c.blocks.storyboardScenes === true));
}

function conversionPrompt(target: ManuscriptKind, intent: CreationIntent, request: string, conversation: FilmInput["conversation"] | undefined, chapters: ManuscriptContent[]) {
  if (chapters.reduce((sum, c) => sum + c.blocks.body.length, 0) > 100000)
    throw bad("请将超过10万字的内容拆成较短作品再转换");
  return {
    systemPrompt: [
      "你是创作编辑。根据本故事的用途、观众、平台和最新要求改编。原文作为素材，保留事实；助手建议和待确认字段不能当作作者要求。",
      target === "storyboard"
        ? shotFormatGuide + (useScenesForDraft(request, conversation, chapters)
            ? " 本版已要求分场：使用scene作场标题，场内shot的parent指向所属scene。" : " 本版只按连续镜号写，禁止场号、场标题和scene模块；只输出shot和text，shot的parent为null。") + "说明和素材放在所属shot内。"
        : "文字版用heading1/heading2/text组成章、节和正文。",
      "输出JSON {chapters:[{title,modules:[{format,text,parent,media?,dialogue?}]}]}。章节数及顺序与输入一致。parent为本章前序模块的零基下标或null。实际朗读的原句放在独立text模块并标dialogue=true。标题、表演和声画说明均为普通文字。",
      "每章source.media里的原媒体必须各引用一次，使用单独text模块的media下标。其他模块只写正文。不得虚构媒体、产品效果或事实，不把配乐建议当作已有成品。",
    ].join("\n"),
    context: { target, intent, request, conversation, source: conversionSource(chapters) },
    maxTokens: 12000,
    failureMode: "throw" as const,
  };
}

export async function proposeManuscriptConversion(
  input: ActorInput & {
    id: string;
    sourceId: string;
    target: ManuscriptKind;
    chapterId?: number;
    intent: CreationIntent;
    request: string;
    conversation?: Array<{ role: "user" | "assistant"; content: string }>;
    regenerate?: boolean;
    quoteFingerprint?: string;
  }
) {
  let claimed = false;
  const draft = await mutateBookWorkflow(input, ({ state, rows }) => {
    const existing = state.conversions.find(d => d.id === input.id);
    if (existing) {
      if (
        existing.source.id !== input.sourceId || (existing.entryChapterId !== undefined && existing.entryChapterId !== input.chapterId) ||
        existing.target !== input.target ||
        JSON.stringify(existing.intent) !== JSON.stringify(input.intent) ||
        existing.request !== input.request ||
        JSON.stringify(existing.conversation ?? []) !== JSON.stringify(input.conversation ?? [])
      )
        throw conflict();
      return { result: existing };
    }
    const source = state.versions.find(v => v.id === input.sourceId);
    if (!source || (source.kind === input.target && !input.regenerate))
      throw bad("请选择另一类型的来源版本");
    if (
      manuscriptFingerprint(manuscriptRows(rows, source.kind)) !==
      source.fingerprint
    )
      throw conflict("来源稿有未形成版本的修改，请先保存新版本。");
    if (
      state.conversions.some(
        d =>
          d.status === "generating" && Date.now() - d.createdAt < 15 * 60 * 1000
      )
    )
      throw conflict("已有转换正在处理，请等待结果，避免重复提交。");
    if (state.conversions.length >= 100)
      throw bad("转换记录已达上限，已有草稿保留");
    const live = manuscriptRows(rows, source.kind);
    const chosen = input.regenerate && source.kind === "storyboard" && input.target === "storyboard"
      ? bookProductionChapters(live, input.chapterId) : live;
    if (!chosen.length) throw bad("请打开要修改的分镜稿。");
    const revisedChapters = chosen.length === live.length ? undefined : chosen.map(c => ({ id: c.id, index: live.indexOf(c) }));
    conversionSource(revisedChapters ? revisedChapters.map(c => source.chapters[c.index]) : source.chapters);
    const draft = {
      id: input.id,
      ...(input.chapterId !== undefined ? { entryChapterId: input.chapterId } : {}),
      ...(revisedChapters ? { revisedChapters } : {}),
      target: input.target,
      source: versionReference(source),
      intent: input.intent,
      request: input.request,
      conversation: input.conversation,
      author: input.actor,
      createdAt: Date.now(),
      status: "generating" as const,
      revision: 1,
      sourceFingerprint: source.fingerprint,
      targetFingerprint: manuscriptFingerprint(
        manuscriptRows(rows, input.target)
      ),
    };
    state.conversions.push(draft);
    claimed = true;
    return { result: draft };
  });
  if (!claimed) return draft;
  let live: ReturnType<typeof beginLiveManuscript> | undefined;
  try {
    const { state } = await getBookWorkflow(input),
      source = state.versions.find(v => v.id === input.sourceId)!;
    const selected = draft.revisedChapters?.map(c => source.chapters[c.index]) ?? source.chapters;
    const showScenes = useScenesForDraft(input.request, input.conversation, selected);
    live = beginLiveManuscript(input, input.id, input.target, { showScenes });
    const response = await runPublishingVideoStoryboardTextCompute({
      onTextDelta: live.append,
      ...conversionPrompt(input.target, input.intent, input.request, input.conversation, selected),
      quoteFingerprint: input.quoteFingerprint,
    });
    const chapters = applyConversion(
      selected,
      input.target,
      response.parsed,
      showScenes
    );
    const saved = await mutateBookWorkflow(input, ({ state }) => {
      const current = state.conversions.find(d => d.id === input.id)!;
      current.chapters = chapters;
      current.status = "review";
      current.revision++;
      return { result: current };
    });
    live.finishChapters(chapters);
    return saved;
  } catch (error) {
    live?.fail();
    const failure = error instanceof z.ZodError
      ? new TRPCError({ code: "BAD_GATEWAY", message: "生成服务返回的稿件结构不完整，本次未建立新版本。原稿与历史已保留。", cause: error })
      : error instanceof TRPCError
        ? error
        : new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "新版本生成未完成，原稿与历史已保留。请先核对任务状态再继续。", cause: error });
    await mutateBookWorkflow(input, ({ state }) => {
      const current = state.conversions.find(d => d.id === input.id)!;
      current.status = "failed";
      current.error = failure.message;
      current.revision++;
      return { result: current };
    });
    throw failure;
  }
}

/** Resolve the same source and intent for the free quote and the subsequent generation. */
function filmSource(rows: Awaited<ReturnType<typeof listChapters>>, state: BookWorkflowState, input: FilmInput) {
  const live = rows.filter(row => !row.blocks.manuscriptArchived);
  if (input.chapterId && !live.some(row => row.id === input.chapterId)) throw conflict("当前书稿已变化，请重新打开后生成。");
  const storyboards = manuscriptRows(live, "storyboard");
  const text = manuscriptRows(live, "text");
  const kind: ManuscriptKind = input.chapterId ? (storyboards.some(row => row.id === input.chapterId) ? "storyboard" : "text")
    : (text.length || !storyboards.length ? "text" : "storyboard");
  const active = kind === "text" ? text : storyboards;
  const current = currentManuscript(state, kind);
  const intent = current?.intent ?? { purpose: "根据这次聊天生成新版本", audience: "待确认", platform: "待确认" };
  const requestedIntent = { ...intent, purpose: input.request.trim().slice(0, 1000) || intent.purpose };
  if (active.length) {
    const selected = kind === "storyboard" && (input.target ?? "storyboard") === "storyboard"
      ? bookProductionChapters(active, input.chapterId) : active;
    if (!selected.length) throw bad("请打开要修改的分镜稿。");
    return { kind, chapters: active, selected, current, intent, requestedIntent };
  }
  const materialTurns = input.conversation.filter(turn => turn.role === "user" && turn.content.trim() &&
    turn.content.trim() !== input.request.trim() && !needsFilmSubject(turn.content));
  const body = materialTurns.map(turn => turn.content).join("\n\n") ||
    (needsFilmSubject(input.request) ? "" : input.request.trim());
  if (!body || input.target === "text") throw bad("请先打开书稿，或告诉我想拍什么。");
  const material: ManuscriptContent = { title: "聊天原话", layout: null, blocks: {
    body, blockIds: body.split("\n").filter(line => line.trim()).map(() => randomUUID()), manuscriptKind: "text",
    containsAiText: false, settings: null, coverKey: null, bodyTextureKey: null, images: {}, illustrations: [],
  } };
  return { kind, chapters: [material], selected: [material], current, intent, requestedIntent, fromChat: true };
}

export async function quoteFilmManuscript(input: Owner & FilmInput) {
  const story = await getStoryById(input.storyId, input.userId);
  if (!story) throw new TRPCError({ code: "NOT_FOUND", message: "故事不存在" });
  const source = filmSource(await listChapters(input.storyId, input.userId, "all"),
    readBookWorkflow((story.body as Record<string, unknown>)?.bookWorkflow), input);
  return quoteStoryboardCompute(conversionPrompt(input.target ?? "storyboard", source.requestedIntent, input.request, input.conversation, source.selected));
}

export async function generateFilmManuscript(input: ActorInput & FilmInput & { id: string }) {
  const workflow = await getBookWorkflow(input);
  const previous = workflow.state.conversions.find(draft => draft.id === input.id);
  if (previous) {
    if ((previous.entryChapterId !== undefined && previous.entryChapterId !== input.chapterId) || previous.target !== (input.target ?? "storyboard") || previous.request !== input.request || JSON.stringify(previous.conversation ?? []) !== JSON.stringify(input.conversation)) throw conflict();
    return previous;
  }
  const source = await mutateBookWorkflow(input, ({ state, rows }) => {
    const { kind, chapters, selected, current, requestedIntent, fromChat } = filmSource(rows, state, input);
    if (input.quoteFingerprint && quoteStoryboardCompute(conversionPrompt(input.target ?? "storyboard", requestedIntent, input.request, input.conversation, selected)).fingerprint !== input.quoteFingerprint)
      throw conflict("分镜内容或报价已变化，请重新查看费用。");
    if (!fromChat && current?.fingerprint === manuscriptFingerprint(chapters)) return { result: current };
    const result = appendVersion(state, {
      id: randomUUID(), kind, chapters, actor: input.actor, intent: current?.intent ?? requestedIntent,
      summary: fromChat ? "本次分镜使用的聊天原话" : "生成影片方案前保留的书稿", source: current?.source,
    });
    return { result, ...(fromChat ? { replace: { kind, chapters } } : {}) };
  });
  const intent = { ...source.intent, purpose: input.request.trim().slice(0, 1000) || source.intent.purpose };
  return proposeManuscriptConversion({ ...input, sourceId: source.id, target: input.target ?? "storyboard", intent, regenerate: true });
}
export async function editConversionDraft(
  input: Owner & { actor?: VersionActor } & {
    id: string;
    revision: number;
    texts: string[][];
  }
) {
  return mutateBookWorkflow(input, ({ state }) => {
    const draft = state.conversions.find(d => d.id === input.id);
    if (
      !draft?.chapters ||
      draft.status !== "review" ||
      draft.revision !== input.revision
    )
      throw conflict();
    if (input.texts.length !== draft.chapters.length)
      throw bad("章节数量不匹配");
    draft.chapters = draft.chapters.map((chapter, i) => {
      const oldTexts = writingModuleTexts(
          chapter.blocks.body,
          chapter.blocks.writingStyle
        ),
        texts = input.texts[i];
      if (
        texts.length !== oldTexts.length ||
        texts.some((text, j) =>
          mediaText(oldTexts[j])
            ? text !== oldTexts[j]
            : text.split("\n").some(mediaText)
        )
      )
        throw bad("请保持素材与模块对应关系");
      const body = texts.join("\n"),
        style = chapter.blocks.writingStyle!.map((row, j) => ({
          ...row,
          lineCount: texts[j].split("\n").length,
        }));
      if (body.length > 200000 || !validWritingStyle(body, style))
        throw bad("稿件太长或结构不完整");
      return {
        ...chapter,
        blocks: {
          ...chapter.blocks,
          body,
          writingStyle: style,
          blockIds: body
            .split("\n")
            .filter(line => line.trim())
            .map(() => randomUUID()),
        },
      };
    });
    draft.editedBy = input.actor;
    draft.updatedAt = Date.now();
    draft.revision++;
    return { result: draft };
  });
}
export async function adoptManuscriptConversion(
  input: ActorInput & { id: string; revision: number }
) {
  const before = (await getBookWorkflow(input)).state.conversions.find(d => d.id === input.id);
  return mutateBookWorkflow({ ...input, ...(before?.source.kind === "video" && before.status !== "adopted"
    ? { expectedTimelineVersion: before.source.timelineVersion } : {}) }, ({ state, rows }) => {
    const draft = state.conversions.find(d => d.id === input.id);
    if (draft?.status === "adopted")
      return { result: state.versions.find(v => v.id === draft.adoptedId)! };
    if (
      !draft?.chapters ||
      draft.status !== "review" ||
      draft.revision !== input.revision
    )
      throw conflict();
    if (
      (draft.source.kind !== "video" && manuscriptFingerprint(manuscriptRows(rows, draft.source.kind)) !==
        draft.sourceFingerprint) ||
      manuscriptFingerprint(manuscriptRows(rows, draft.target)) !==
        draft.targetFingerprint
    )
      throw conflict(
        "转换期间原稿或目标稿已更新，请重新转换；这份方案仍保留。"
      );
    const old = manuscriptRows(rows, draft.target),
      current = currentManuscript(state, draft.target);
    const hasPreviousContent = draft.source.kind!=="video" || old.some(c=>c.blocks.body.trim() || Object.keys(c.blocks.images??{}).length || (c.blocks.illustrations?.length??0)>0 || c.blocks.coverKey || c.blocks.bodyTextureKey || c.layout?.pages.some(p=>p.modules.length));
    if (old.length && hasPreviousContent && current?.fingerprint !== draft.targetFingerprint)
      appendVersion(state, {
        id: randomUUID(),
        kind: draft.target,
        chapters: old,
        intent: current?.intent ?? draft.intent,
        actor: input.actor,
        summary: "转换采用前保留的目标草稿",
      });
    const selectedChanges = draft.revisedChapters?.map((ref, i) => {
      if (old[ref.index]?.id !== ref.id || !draft.chapters?.[i]) throw conflict();
      return [ref.id, draft.chapters[i]] as const;
    });
    const revisions = new Map(selectedChanges);
    const adoptedChapters = selectedChanges ? old.map(c => revisions.get(c.id) ?? c) : draft.chapters;
    const version = appendVersion(state, {
      id: randomUUID(),
      kind: draft.target,
      chapters: adoptedChapters,
      intent: draft.intent,
      actor: input.actor,
      summary:
        draft.request ||
        `按创作目的从${manuscriptLabel(draft.source.kind)} V${draft.source.number}改编`,
      source: draft.source,
      aiAssisted: true,
    });
    version.author = draft.author;
    version.editedBy = draft.editedBy ?? draft.author;
    draft.status = "adopted";
    draft.adoptedId = version.id;
    draft.revision++;
    delete draft.chapters;
    return {
      result: version,
      replace: { kind: draft.target, chapters: adoptedChapters, ...(selectedChanges ? { updatedChapterIds: [...revisions.keys()] } : {}) },
    };
  });
}
