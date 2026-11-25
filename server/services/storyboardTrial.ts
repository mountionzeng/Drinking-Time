import { createHash, randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type {
  ConversionDraft,
  ManuscriptContent,
} from "../../shared/bookWorkflow";
import {
  bookManuscriptModules,
  readBookShotChapter,
} from "../../shared/bookShotDocument";
import { readShotField, shotFormatGuide } from "../../shared/bookShotFormat";
import { justNamesTrial, requestedShots, shotOrdinal, trialInstruction } from "../../shared/storyboardTrial";
import {
  validWritingStyle,
  type BookWritingStyle,
} from "../../shared/bookWritingStyle";
import { readBookImage } from "../../shared/bookImageBlock";
import { readBookAudio } from "../../shared/bookAudioBlock";
const invalid = (message: string) =>
  new TRPCError({ code: "BAD_REQUEST", message });
export const trialImport = z.object({
  label: z.string().trim().min(1).max(100),
  sourceLabel: z.string().trim().min(1).max(300),
  notes: z.string().max(8000).optional(),
  shots: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        shotModuleId: z.string().min(1).max(100).optional(),
        paragraphs: z
          .array(
            z.object({
              text: z.string().trim().min(1).max(12000),
              dialogue: z.boolean().optional(),
            })
          )
          .min(1)
          .max(100),
      })
    )
    .min(1)
    .max(300),
});
function checkText(text: string) {
  if (
    text.split("\n").some(t => readBookImage(t) || readBookAudio(t)) ||
    /!\[[^\]]*\]\(/.test(text)
  )
    throw invalid("文字试稿不能插入媒体引用。");
}
type Module = { row: BookWritingStyle[number]; text: string };
function pack(ch: ManuscriptContent, modules: Module[]) {
  const body = modules.map(m => m.text).join("\n");
  const priorLines = new Map<string, string[]>();
  let offset = 0;
  for (const m of bookManuscriptModules(ch.blocks)) {
    if (!m.row) continue;
    const count = m.text.split("\n").filter(line => line.trim()).length;
    priorLines.set(m.row.id, ch.blocks.blockIds.slice(offset, offset + count));
    offset += count;
  }
  const writingStyle = modules.map(({ row, text }) => ({
    ...row,
    lineCount: text.split("\n").length,
  }));
  if (body.length > 200000 || !validWritingStyle(body, writingStyle))
    throw invalid("试稿文字或层级超出限制。");
  return {
    ...ch,
    blocks: {
      ...ch.blocks,
      body,
      writingStyle,
      containsAiText: true,
      blockIds: modules.flatMap(({ row, text }) =>
        text
          .split("\n")
          .filter(t => t.trim())
          .map((_, i) => priorLines.get(row.id)?.[i] ?? randomUUID())
      ),
    },
  };
}
export function editTrialTexts(chapter: ManuscriptContent, texts: string[]) {
  return pack(
    chapter,
    chapter.blocks.writingStyle!.map((row, i) => ({ row, text: texts[i] }))
  );
}

export function importedReading(
  base: ManuscriptContent,
  input: z.infer<typeof trialImport>
) {
  const previous =
    base.blocks.writingStyle?.filter(r => r.format === "shot") ?? [];
  const modules: Module[] = [];
  for (const shot of input.shots) {
    checkText(shot.title);
    if (shot.shotModuleId && !previous.some(s => s.id === shot.shotModuleId))
      throw invalid("导入的镜头编号与这份底稿不符。");
    const id = shot.shotModuleId ?? randomUUID();
    modules.push({
      row: { id, format: "shot", parentId: null, collapsed: false },
      text: shot.title,
    });
    for (const p of shot.paragraphs) {
      checkText(p.text);
      modules.push({
        row: {
          id: randomUUID(),
          format: "text",
          parentId: id,
          collapsed: false,
          ...(p.dialogue ? { videoRole: "dialogue" as const } : {}),
        },
        text: p.text,
      });
    }
  }
  return pack(
    {
      title: base.title,
      layout: null,
      blocks: {
        body: "",
        blockIds: [],
        containsAiText: true,
        manuscriptKind: "storyboard",
        settings: null,
        coverKey: null,
        bodyTextureKey: null,
        images: {},
        illustrations: [],
      },
    },
    modules
  );
}

const editFields: Record<string,string> = {画面:"picture",运镜:"motion",音效:"sound",旁白:"voice",台词:"voice",字幕:"subtitle"};
const fieldName = "(?:画面|运镜|音效|旁白|台词|字幕)";
const fieldRequest = new RegExp("(?:试写|补写|补上|加上|新增|(?:只(?:想)?|单独)(?:改|写|换|调整))" +
  "(?:一(?:条|句|段)|简短的|短的|本镜的|一点|一下|这镜的|的|个|\\s)*(?:"+shotOrdinal+"\\s*的?)?\\s*("+
  fieldName+"(?:提示词|说明)?(?:\\s*(?:和|、|及|与)\\s*"+fieldName+"(?:提示词|说明)?)*)","gu");
const quotedEdit = new RegExp("^(?:请|帮我|把|将|只换|只改|\\s)*"+shotOrdinal+"[，,的\\s]*(?:把|将)?("+fieldName+
  ")(?:原句|提示词)?(?:改成|改为|换成|写成|[：:])[：:\\s]*[“「\"]([^”」\"\\n]+)[”」\"](?:[，,。\\s]*(?:旁白|台词|音效|字幕|其余|其他)(?:原句)?(?:都)?(?:照旧|不变|不动|不改))*[。.!！\\s]*$","u");

function moduleField(text:string) {
  if (/^(?:字幕|屏幕文字)[：:]/u.test(text.trim())) return "subtitle";
  return readShotField(text)?.kind;
}

type History = Array<{ role: "user" | "assistant"; content: string }>;
export function trialEditor(
  chapters: ManuscriptContent[],
  request: string,
  conversation: History,
  parent?: ConversionDraft
) {
  const byChapter = chapters.map((c, i) => {
    if (
      !c.blocks.writingStyle ||
      !validWritingStyle(c.blocks.body, c.blocks.writingStyle)
    )
      throw invalid("请先整理分镜模块。");
    const document = readBookShotChapter({ id: i + 1, blocks: c.blocks });
    const modules = bookManuscriptModules(c.blocks);
    return document.shots.map(s => ({
      chapter: i,
      title: s.title,
      id: s.moduleId,
      modules: modules.flatMap((m, j) =>
        m.row &&
        document.nodes.get(m.row.id)?.shot === s.moduleId &&
        !m.image &&
        !m.audio
          ? [
              {
                index: j,
                text: m.text,
                role:
                  m.dialogue !== undefined
                    ? "旁白"
                    : m.row.format === "shot"
                      ? "标题"
                      : "说明",
              },
            ]
          : []
      ),
    }));
  });
  const all = byChapter.flat();
  if (!all.length) throw invalid("当前稿件还没有镜头。");
  let numbers = requestedShots(request, all.length);
  if (
    !numbers.length &&
    parent?.trial?.changedShots?.length &&
    /^(?:再|这里|这一镜|这句|这个镜头|还是)/u.test(request) &&
    !/全片|整片|所有镜头/u.test(request)
  )
    numbers = parent.trial.changedShots;
  const chosen = all
    .map((s, i) => ({ ...s, shot: i + 1 }))
    .filter(s => !numbers.length || numbers.includes(s.shot));
  const instruction=trialInstruction(request);
  const literal = quotedEdit.exec(request.trim());
  const lockVoice = /(?:保留|照用|沿用)(?:原有|原)?(?:旁白|台词)|(?:旁白|台词)(?:原句)?(?:照旧|保持原样|不变|不改|不要动|不动)|(?:不改|不动)(?:旁白|台词)/u.test(instruction);
  const fields = new Set([...instruction.matchAll(fieldRequest)].flatMap(m=>
    (m[1].match(/画面|运镜|音效|旁白|台词|字幕/gu) ?? []).map(name=>editFields[name])));
  if (literal) fields.add(editFields[literal[1]]);
  const allowed = new Map(chosen.map(s => [s.shot, s]));
  const context = {
    request,
    conversation,
    basis: parent?.trial?.label ?? "当前分镜",
    notes: parent?.trial?.notes,
    outline: all.map((s, i) => ({ shot: i + 1, title: s.title })),
    editable: chosen.map(({ shot, title, modules }) => ({
      shot,
      title,
      modules,
    })),
  };
  if (JSON.stringify(context).length > 200000)
    throw invalid("上下文过长，请缩小镜头范围。");
  const prompt = {
    context,
    failureMode: "throw" as const,
    maxTokens: 5000,
    systemPrompt: [
      "你是和作者一起试读分镜的文字编辑。按最新要求在当前实际稿件上试改，结合前面讨论区分作者原话、助手提案与试排值。只改明确要求的内容。保留原话、出处和悬而未决的选择。避免声画组合暗示无依据的人物行动、拍摄日期。",
      shotFormatGuide,
      '输出 JSON {"changes":[{"shot":镜号,"index":已有模块的index,"text":"该模块的完整新文字"}]}。补写新栏目时省略index，text带栏目名，仅新增朗读原句时标dialogue:true。原图、原声音和未涉及的文字由系统原样保留。只输出实际需要的改动；整片试读若无需再改，changes为空数组。',
    ].join("\n"),
  };
  function apply(value: unknown) {
    const { changes } = z
      .object({
        changes: z
          .array(
            z.object({
              shot: z.number().int().positive(),
              index: z.number().int().nonnegative().optional(),
              text: z.string().trim().min(1).max(12000),
              dialogue: z.boolean().optional(),
            })
          )
          .max(800),
      })
      .parse(value);
    const replacements = new Map<string, string>(),
      additions = new Map<string, Module[]>(),
      touched = new Set<number>();
    for (const change of changes) {
      checkText(change.text);
      const shot = allowed.get(change.shot);
      if (!shot) throw invalid("试改超出了指定镜头，原稿保留。");
      if (
        lockVoice &&
        (change.dialogue ||
          shot.modules.find(m => m.index === change.index)?.role === "旁白")
      )
        throw invalid("试改触及要求保留的旁白，请重新核对。");
      if (fields.size) {
        const prior = shot.modules.find(m => m.index === change.index);
        const beforeField =
          prior?.role === "旁白"
            ? "voice"
            : prior && moduleField(prior.text);
        const afterField =
          change.dialogue || prior?.role === "旁白"
            ? "voice"
            : moduleField(change.text);
        const crossesField = (text:string) => text.split("\n").some(line=>{
          const kind=moduleField(line);
          return kind && !fields.has(kind);
        });
        if (
          crossesField(change.text) || (prior && crossesField(prior.text)) ||
          !fields.has(afterField ?? "") ||
          (prior && !fields.has(beforeField ?? ""))
        )
          continue;
      }
      const key = shot.chapter + ":" + change.index;
      if (change.index !== undefined) {
        if (
          !shot.modules.some(m => m.index === change.index) ||
          replacements.has(key)
        )
          throw invalid("试改的模块归属不匹配。");
        replacements.set(key, change.text);
      } else {
        const k = shot.chapter + ":" + shot.id;
        const list = additions.get(k) ?? [];
        list.push({
          row: {
            id: randomUUID(),
            parentId: shot.id,
            format: "text",
            collapsed: false,
            ...(change.dialogue ? { videoRole: "dialogue" as const } : {}),
          },
          text: change.text,
        });
        additions.set(k, list);
      }
      touched.add(change.shot);
    }
    if (fields.size && !touched.size)
      throw invalid("返回文字未能对应指定栏目，试稿没有写入。");
    const result = chapters.map((c, i) => {
      if (!changes.some(change => allowed.get(change.shot)?.chapter === i))
        return c;
      const doc = readBookShotChapter({ id: i + 1, blocks: c.blocks });
      const modules = bookManuscriptModules(c.blocks).flatMap(
        ({ row, text }, j) => {
          const shot = doc.nodes.get(row!.id)?.shot;
          const next = c.blocks.writingStyle?.[j + 1];
          const end = shot && (!next || doc.nodes.get(next.id)?.shot !== shot);
          return [
            { row: row!, text: replacements.get(i + ":" + j) ?? text },
            ...(end ? (additions.get(i + ":" + shot) ?? []) : []),
          ];
        }
      );
      return pack(c, modules);
    });
    return { chapters: result, changedShots: [...touched] };
  }
  // An explicit, quoted author line needs no inference. Ambiguous edits use the quoted model path.
  let exact:
    | {
        changes: Array<{
          shot: number;
          index?: number;
          text: string;
          dialogue?: boolean;
        }>;
      }
    | undefined;
  if (literal && chosen.length === 1) {
    const [, field, line] = literal,
      shot = chosen[0];
    const spoken = field === "旁白" || field === "台词";
    const label = field === "字幕" ? "屏幕文字" : field + "提示词";
    const matching = shot.modules.filter(m =>
      spoken
        ? m.role === "旁白"
        : m.role === "说明" &&
          moduleField(m.text) === editFields[field]
    );
    if (matching.length <= 1)
      exact = {
        changes: [
          {
            shot: shot.shot,
            index: matching[0]?.index,
            text: spoken ? line : label + "：" + line,
            ...(spoken ? { dialogue: true } : {}),
          },
        ],
      };
  }
  if (justNamesTrial(request)) exact = { changes: [] };
  const freeQuote = exact
    ? {
        estimatedCny: 0,
        fingerprint:
          "author:" +
          createHash("sha256")
            .update(JSON.stringify({ context, exact }))
            .digest("hex"),
      }
    : undefined;
  return { prompt, apply, exact, freeQuote };
}
