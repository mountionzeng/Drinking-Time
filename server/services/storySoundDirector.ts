import { createHash } from "node:crypto";
import {
  confirmSoundPlanDraftText,
  normalizeStorySoundPlanDraft,
  type StorySoundEvidenceReference,
  type StorySoundPlanDraft,
  type StorySoundPlanRow,
  type StorySoundRowKind,
} from "../../shared/storySoundPlan";
import {
  getStorySoundPlanVersion,
  loadStorySoundWorkspace,
  saveStorySoundPlanVersion,
  saveStorySoundWorkspace,
} from "./storySoundPlanStore";
import {
  compileStorySoundContext,
  evidenceReference,
  type StorySoundContextPacket,
  type StorySoundEvidenceCertainty,
  type StorySoundEvidenceItem,
} from "./storySoundContext";
import {
  consumeStorySoundRateAllowance,
  StorySoundLimitError,
} from "./storySoundLimits";
import { appendStorySoundDirectorConversationSummary } from "./storyConversation";

export type StorySoundQuestionOption = {
  id: string;
  label: string;
  value: string;
  evidenceIds: string[];
};

export type StorySoundInterviewQuestion = {
  id: string;
  category: "global" | StorySoundRowKind;
  sceneId?: string;
  prompt: string;
  why: string;
  evidence: StorySoundEvidenceReference[];
  sourceText: string;
  sourceCertainty?: StorySoundEvidenceCertainty;
  existingTimelineClipId?: string;
  options: StorySoundQuestionOption[];
  freeTextAllowed: boolean;
};

export type StorySoundInterviewAnswer = {
  stepId: string;
  value: string;
  optionId?: string;
  answeredAt: string;
};

export type StorySoundInterviewSuggestion = StorySoundInterviewAnswer & {
  reason: "earlier_answer_changed";
};

export type StorySoundInterviewState = {
  schemaVersion: 1;
  evidenceSnapshotDigest: string;
  sourceRevisions: Record<string, string>;
  questions: StorySoundInterviewQuestion[];
  answers: StorySoundInterviewAnswer[];
  reviewSuggestions: StorySoundInterviewSuggestion[];
  currentStepIndex: number;
  evidenceChanged: boolean;
};

type SummaryWriter = (
  input: Parameters<typeof appendStorySoundDirectorConversationSummary>[0]
) => Promise<unknown>;
type DirectorDependencies = {
  compileContext?: typeof compileStorySoundContext;
  appendSummary?: SummaryWriter;
  now?: () => Date;
};

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const clean = (value: unknown, max = 2_000) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

function assertInterviewAllowance(userId: number) {
  const allowance = consumeStorySoundRateAllowance({
    userId,
    bucket: "interview_model",
  });
  if (!allowance.allowed) {
    throw new StorySoundLimitError("声音方案问题生成过于频繁，请稍后再试", {
      retryAfterSeconds: allowance.retryAfterSeconds,
    });
  }
}

function kindLabel(kind: StorySoundRowKind) {
  return {
    dialogue: "人物对白",
    narration: "旁白",
    music: "配乐",
    ambience: "环境声",
    sfx: "音效",
  }[kind];
}

function questionKey(item: StorySoundEvidenceItem) {
  const normalizedText = item.text.replace(/\s+/g, "").toLowerCase();
  return `${item.soundKind}:${item.sceneId ?? "story"}:${normalizedText}:${
    item.existingTimelineClipId ? "existing" : "proposed"
  }`;
}

function globalOptions(
  packet: StorySoundContextPacket
): StorySoundQuestionOption[] {
  const storyEvidence = packet.evidence.filter(
    item => item.sourceKind === "story" || !item.soundKind
  );
  const grounding = (storyEvidence.length ? storyEvidence : packet.evidence)
    .slice(0, 6)
    .map(item => item.id);
  const supported = new Set(
    packet.evidence.flatMap(item => (item.soundKind ? [item.soundKind] : []))
  );
  const options: StorySoundQuestionOption[] = [
    {
      id: "faithful",
      label: "忠于原始故事，不增加新剧情",
      value: "忠于原始故事，不增加新剧情",
      evidenceIds: grounding,
    },
  ];
  if (supported.has("dialogue") || supported.has("narration")) {
    options.push({
      id: "speech-first",
      label: "先保证对白和旁白清楚",
      value: "对白和旁白清楚，其他声音保持克制",
      evidenceIds: packet.evidence
        .filter(
          item =>
            item.soundKind === "dialogue" || item.soundKind === "narration"
        )
        .slice(0, 6)
        .map(item => item.id),
    });
  }
  if (supported.has("ambience") || supported.has("sfx")) {
    options.push({
      id: "environment-first",
      label: "先保留故事里已有的环境质感",
      value: "沿用故事已有的环境声和动作声，不额外造声",
      evidenceIds: packet.evidence
        .filter(
          item => item.soundKind === "ambience" || item.soundKind === "sfx"
        )
        .slice(0, 6)
        .map(item => item.id),
    });
  }
  if (options.length < 2) {
    options.push({
      id: "scene-by-scene",
      label: "不预设风格，逐场确认",
      value: "不预设额外风格，逐场确认声音需求",
      evidenceIds: grounding,
    });
  }
  return options.slice(0, 4);
}

export function buildStorySoundInterviewState(
  packet: StorySoundContextPacket
): StorySoundInterviewState {
  const globalEvidence = packet.evidence
    .filter(item => item.sourceKind === "story" || !item.soundKind)
    .slice(0, 6);
  const questions: StorySoundInterviewQuestion[] = [
    {
      id: "global-direction",
      category: "global",
      prompt: "先定一个总方向：这版声音最重要的原则是什么？",
      why: "后面的对白、旁白、配乐和环境声都会沿用这个原则。",
      evidence: globalEvidence.map(evidenceReference),
      sourceText: globalEvidence
        .map(item => item.text)
        .join("；")
        .slice(0, 1_000),
      options: globalOptions(packet),
      freeTextAllowed: true,
    },
  ];

  const grouped = new Map<string, StorySoundEvidenceItem[]>();
  for (const item of packet.evidence) {
    if (!item.soundKind) continue;
    const key = questionKey(item);
    const items = grouped.get(key) ?? [];
    items.push(item);
    grouped.set(key, items);
  }
  const order: Record<StorySoundRowKind, number> = {
    dialogue: 0,
    narration: 1,
    music: 2,
    ambience: 3,
    sfx: 4,
  };
  const existingKinds = new Set(
    packet.evidence.flatMap(item =>
      item.soundKind && item.existingTimelineClipId ? [item.soundKind] : []
    )
  );
  const groups = [...grouped.values()].sort((a, b) => {
    const kindDelta = order[a[0]!.soundKind!] - order[b[0]!.soundKind!];
    return (
      kindDelta || (a[0]!.sceneId ?? "").localeCompare(b[0]!.sceneId ?? "")
    );
  });
  groups.forEach((items, index) => {
    const first = items[0]!;
    const kind = first.soundKind!;
    if (!first.existingTimelineClipId && existingKinds.has(kind)) return;
    const evidenceIds = items.map(item => item.id);
    const id = `${kind}-${index + 1}-${digest(evidenceIds.join("|")).slice(0, 10)}`;
    if (first.existingTimelineClipId) {
      questions.push({
        id,
        category: kind,
        ...(first.sceneId ? { sceneId: first.sceneId } : {}),
        prompt: `时间线已经有一条${kindLabel(kind)}，这版是否直接沿用？`,
        why: "默认沿用已有片段，避免重复生成同一种声音。",
        evidence: items.map(evidenceReference),
        sourceText: first.text,
        sourceCertainty: first.certainty,
        existingTimelineClipId: first.existingTimelineClipId,
        options: [
          {
            id: "keep-existing",
            label: "沿用现有声音",
            value: "keep-existing",
            evidenceIds,
          },
          {
            id: "skip",
            label: "这版不用这条声音",
            value: "skip",
            evidenceIds,
          },
        ],
        freeTextAllowed: false,
      });
      return;
    }
    const options: StorySoundQuestionOption[] = [];
    if (kind === "dialogue" && first.certainty === "verbatim") {
      for (const character of packet.characters.slice(0, 3)) {
        options.push({
          id: `character:${character.id}`,
          label: `${character.name}${character.role ? `（${character.role}）` : ""}`,
          value: `character:${character.id}`,
          evidenceIds: [...evidenceIds, character.evidenceId],
        });
      }
      options.push({
        id: "unassigned",
        label: "先不指定人物",
        value: "unassigned",
        evidenceIds,
      });
    } else if (kind === "dialogue") {
      options.push({
        id: "draft",
        label: "保留为待确认草稿",
        value: "draft",
        evidenceIds,
      });
    } else {
      options.push({
        id: "include",
        label: `加入这条${kindLabel(kind)}`,
        value: "include",
        evidenceIds,
      });
    }
    options.push({
      id: "skip",
      label: "这版先不加入",
      value: "skip",
      evidenceIds,
    });
    questions.push({
      id,
      category: kind,
      ...(first.sceneId ? { sceneId: first.sceneId } : {}),
      prompt:
        kind === "dialogue" && first.certainty !== "verbatim"
          ? `故事只写了说话意图“${first.text}”，没有原句。要怎么处理？`
          : `关于“${first.text}”，这版声音怎么处理？`,
      why:
        kind === "dialogue" && first.certainty !== "verbatim"
          ? "没有原台词时不会替你编对白；你可以直接写准确台词。"
          : `这是故事中明确出现的${kindLabel(kind)}线索。`,
      evidence: items.map(evidenceReference),
      sourceText: first.text,
      sourceCertainty: first.certainty,
      options: options.slice(0, 4),
      freeTextAllowed: true,
    });
  });

  return {
    schemaVersion: 1,
    evidenceSnapshotDigest: packet.evidenceSnapshotDigest,
    sourceRevisions: packet.sourceRevisions,
    questions,
    answers: [],
    reviewSuggestions: [],
    currentStepIndex: 0,
    evidenceChanged: false,
  };
}

export function normalizeStorySoundInterviewState(
  value: unknown
): StorySoundInterviewState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<StorySoundInterviewState>;
  if (
    state.schemaVersion !== 1 ||
    typeof state.evidenceSnapshotDigest !== "string" ||
    !state.sourceRevisions ||
    !Array.isArray(state.questions) ||
    !Array.isArray(state.answers) ||
    !Array.isArray(state.reviewSuggestions) ||
    !Number.isInteger(state.currentStepIndex)
  ) {
    return null;
  }
  return state as StorySoundInterviewState;
}

function currentQuestion(state: StorySoundInterviewState) {
  return state.questions[state.currentStepIndex] ?? null;
}

function publicSession(
  workspace: NonNullable<Awaited<ReturnType<typeof loadStorySoundWorkspace>>>
) {
  const interview = normalizeStorySoundInterviewState(workspace.interviewState);
  return {
    workspace,
    interview,
    question: interview ? currentQuestion(interview) : null,
    complete: interview
      ? interview.currentStepIndex >= interview.questions.length
      : workspace.interviewStatus === "draft" ||
        workspace.interviewStatus === "needs_review",
  };
}

export async function startOrResumeStorySoundInterview(
  input: { storyId: number; userId: number },
  dependencies: DirectorDependencies = {}
) {
  const existing = await loadStorySoundWorkspace(input);
  if (existing && normalizeStorySoundInterviewState(existing.interviewState)) {
    return publicSession(existing);
  }
  if (
    existing &&
    (existing.interviewStatus === "draft" ||
      existing.interviewStatus === "needs_review")
  ) {
    return publicSession(existing);
  }
  assertInterviewAllowance(input.userId);
  const packet = await (
    dependencies.compileContext ?? compileStorySoundContext
  )(input);
  if (!packet) throw new Error("故事不存在或不属于当前用户");
  const interviewState = buildStorySoundInterviewState(packet);
  const saved = await saveStorySoundWorkspace({
    ...input,
    expectedRevision: existing?.revision ?? 0,
    draft: existing ?? {
      globalDirection: "",
      rows: [],
      characterVoiceAssignments: [],
    },
    interviewStatus: "interviewing",
    currentStepId: interviewState.questions[0]?.id,
    interviewState,
    selectionByRowId: existing?.selectionByRowId ?? {},
  });
  if (saved.status === "conflict") throw new Error("声音方案已在另一处更新");
  return publicSession(saved.workspace);
}

export async function resumeStorySoundInterview(input: {
  storyId: number;
  userId: number;
}) {
  const workspace = await loadStorySoundWorkspace(input);
  return workspace ? publicSession(workspace) : null;
}

function answerValue(input: {
  question: StorySoundInterviewQuestion;
  optionId?: string;
  freeText?: string;
}) {
  const freeText = clean(input.freeText);
  if (freeText) return { value: freeText };
  const option = input.question.options.find(
    item => item.id === input.optionId
  );
  if (!option) throw new Error("请选择一个选项，或输入自己的答案");
  return { value: option.value, optionId: option.id };
}

function rowFromAnswer(input: {
  question: StorySoundInterviewQuestion;
  value: string;
  optionId?: string;
}): StorySoundPlanRow | null {
  const { question } = input;
  if (
    question.category === "global" ||
    input.value === "skip" ||
    input.value === "keep-existing"
  ) {
    return null;
  }
  const evidenceStartFrames = question.evidence.flatMap(item =>
    item.startFrame === undefined ? [] : [item.startFrame]
  );
  const startFrame =
    evidenceStartFrames.length > 0 ? Math.min(...evidenceStartFrames) : 0;
  const endFrame = Math.max(
    startFrame + 1,
    ...question.evidence.flatMap(item =>
      item.endFrame === undefined ? [] : [item.endFrame]
    )
  );
  const isFreeText = !input.optionId;
  const answerEvidence: StorySoundEvidenceReference[] = isFreeText
    ? [
        ...question.evidence,
        {
          id: `user_answer:${question.id}:${digest(input.value).slice(0, 12)}`,
          sourceKind: "user_answer",
          sourceId: question.id,
          revisionHash: digest(input.value),
          ...(question.sceneId ? { sceneId: question.sceneId } : {}),
        },
      ]
    : question.evidence;
  const base = {
    id: `sound-row:${question.id}`,
    kind: question.category,
    ...(question.sceneId ? { sceneId: question.sceneId } : {}),
    startFrame,
    durationFrames: Math.max(1, endFrame - startFrame),
    evidence: answerEvidence,
    performance: {},
  };
  if (question.category === "dialogue") {
    const isIntentDraft =
      question.sourceCertainty !== "verbatim" && input.value === "draft";
    const characterId = input.value.startsWith("character:")
      ? input.value.slice("character:".length)
      : undefined;
    const userSuppliedExactText =
      isFreeText && question.sourceCertainty !== "verbatim";
    return normalizeStorySoundPlanDraft({
      rows: [
        {
          ...base,
          ...(characterId ? { characterId } : {}),
          text: userSuppliedExactText ? input.value : question.sourceText,
          textOrigin: userSuppliedExactText
            ? "user_authored"
            : isIntentDraft
              ? "ai_draft"
              : "verbatim",
          ...(isFreeText && !userSuppliedExactText
            ? { performance: { style: input.value } }
            : {}),
        },
      ],
    }).rows[0]!;
  }
  if (question.category === "narration") {
    return normalizeStorySoundPlanDraft({
      rows: [
        {
          ...base,
          text: question.sourceText,
          textOrigin: "verbatim",
          ...(isFreeText ? { performance: { style: input.value } } : {}),
        },
      ],
    }).rows[0]!;
  }
  return normalizeStorySoundPlanDraft({
    rows: [
      {
        ...base,
        description: question.sourceText,
        textOrigin: "not_applicable",
        ...(isFreeText ? { performance: { style: input.value } } : {}),
      },
    ],
  }).rows[0]!;
}

async function writeSummary(
  input: Parameters<SummaryWriter>[0],
  dependencies: DirectorDependencies
) {
  const writer =
    dependencies.appendSummary ?? appendStorySoundDirectorConversationSummary;
  await writer(input).catch(error => {
    // The structured workspace is authoritative. Legacy Stories without a
    // prompt-lineage conversation must not lose a valid interview answer.
    console.warn("[StorySoundDirector] 对话摘要写入失败：", error);
  });
}

export async function answerStorySoundInterview(
  input: {
    storyId: number;
    userId: number;
    expectedRevision: number;
    stepId: string;
    optionId?: string;
    freeText?: string;
  },
  dependencies: DirectorDependencies = {}
) {
  const workspace = await loadStorySoundWorkspace(input);
  if (!workspace) throw new Error("声音方案尚未开始");
  if (workspace.revision !== input.expectedRevision) {
    return { status: "conflict" as const, revision: workspace.revision };
  }
  const state = normalizeStorySoundInterviewState(workspace.interviewState);
  if (!state) throw new Error("声音问答状态无效，请重新开始");
  const stepIndex = state.questions.findIndex(item => item.id === input.stepId);
  if (stepIndex < 0 || stepIndex > state.currentStepIndex) {
    throw new Error("当前不能回答这一步");
  }
  const question = state.questions[stepIndex]!;
  const answered = answerValue({
    question,
    optionId: input.optionId,
    freeText: input.freeText,
  });
  const now = (dependencies.now ?? (() => new Date()))().toISOString();
  const oldDownstream = state.answers.filter(answer => {
    const index = state.questions.findIndex(item => item.id === answer.stepId);
    return index >= stepIndex;
  });
  const invalidatedStepIds = new Set(
    state.questions.slice(stepIndex).map(item => item.id)
  );
  const answer: StorySoundInterviewAnswer = {
    stepId: question.id,
    value: answered.value,
    ...(answered.optionId ? { optionId: answered.optionId } : {}),
    answeredAt: now,
  };
  const nextState: StorySoundInterviewState = {
    ...state,
    answers: [
      ...state.answers.filter(item => !invalidatedStepIds.has(item.stepId)),
      answer,
    ],
    reviewSuggestions: [
      ...state.reviewSuggestions,
      ...oldDownstream
        .filter(
          item => item.stepId !== question.id || item.value !== answer.value
        )
        .map(item => ({ ...item, reason: "earlier_answer_changed" as const })),
    ],
    currentStepIndex: stepIndex + 1,
    evidenceChanged: false,
  };
  const derivedRow = rowFromAnswer({
    question,
    value: answered.value,
    optionId: answered.optionId,
  });
  const draft = normalizeStorySoundPlanDraft({
    ...workspace,
    globalDirection:
      question.category === "global"
        ? answered.value
        : workspace.globalDirection,
    rows: [
      ...workspace.rows.filter(row => {
        const rowStepId = row.id.startsWith("sound-row:")
          ? row.id.slice("sound-row:".length)
          : null;
        return !rowStepId || !invalidatedStepIds.has(rowStepId);
      }),
      ...(derivedRow ? [derivedRow] : []),
    ],
  });
  const complete = nextState.currentStepIndex >= nextState.questions.length;
  const saved = await saveStorySoundWorkspace({
    ...input,
    expectedRevision: workspace.revision,
    draft,
    interviewStatus: complete ? "draft" : "interviewing",
    currentStepId: nextState.questions[nextState.currentStepIndex]?.id,
    interviewState: nextState,
    selectionByRowId: {
      ...Object.fromEntries(draft.rows.map(row => [row.id, true])),
      ...workspace.selectionByRowId,
    },
  });
  if (saved.status === "conflict") return saved;
  const nextQuestion = currentQuestion(nextState);
  await writeSummary(
    {
      storyId: input.storyId,
      userId: input.userId,
      workspaceRevision: saved.workspace.revision,
      stepId: question.id,
      answerSummary: answered.value,
      assistantSummary: nextQuestion
        ? nextQuestion.prompt
        : "声音需求已问完，可以检查并修改声音方案。",
    },
    dependencies
  );
  return { status: "ok" as const, ...publicSession(saved.workspace) };
}

export async function goBackStorySoundInterview(input: {
  storyId: number;
  userId: number;
  expectedRevision: number;
}) {
  const workspace = await loadStorySoundWorkspace(input);
  if (!workspace) throw new Error("声音方案尚未开始");
  if (workspace.revision !== input.expectedRevision) {
    return { status: "conflict" as const, revision: workspace.revision };
  }
  const state = normalizeStorySoundInterviewState(workspace.interviewState);
  if (!state) throw new Error("声音问答状态无效，请重新开始");
  const nextState = {
    ...state,
    currentStepIndex: Math.max(0, state.currentStepIndex - 1),
  };
  const saved = await saveStorySoundWorkspace({
    ...input,
    expectedRevision: workspace.revision,
    draft: workspace,
    interviewStatus: "interviewing",
    currentStepId: nextState.questions[nextState.currentStepIndex]?.id,
    interviewState: nextState,
    selectionByRowId: workspace.selectionByRowId,
  });
  return saved.status === "conflict"
    ? saved
    : { status: "ok" as const, ...publicSession(saved.workspace) };
}

export async function confirmStorySoundDraftText(input: {
  storyId: number;
  userId: number;
  expectedRevision: number;
  rowId: string;
  confirmedText: string;
}) {
  const workspace = await loadStorySoundWorkspace(input);
  if (!workspace) throw new Error("声音方案尚未开始");
  if (workspace.revision !== input.expectedRevision) {
    return { status: "conflict" as const, revision: workspace.revision };
  }
  const confirmed = confirmSoundPlanDraftText(workspace, input);
  if (confirmed.status === "error") throw new Error(confirmed.message);
  const saved = await saveStorySoundWorkspace({
    ...input,
    expectedRevision: workspace.revision,
    draft: confirmed.draft,
    interviewStatus: workspace.interviewStatus,
    currentStepId: workspace.currentStepId,
    restoredFromVersionId: workspace.restoredFromVersionId,
    interviewState: workspace.interviewState,
    selectionByRowId: workspace.selectionByRowId,
  });
  return saved.status === "conflict"
    ? saved
    : { status: "ok" as const, workspace: saved.workspace };
}

export async function editStorySoundPlanRow(input: {
  storyId: number;
  userId: number;
  expectedRevision: number;
  rowId: string;
  text?: string;
  description?: string;
  characterId?: string | null;
  startFrame?: number;
  durationFrames?: number;
  performance?: {
    emotion?: string;
    speed?: number;
    intensity?: number;
    style?: string;
  };
}) {
  const workspace = await loadStorySoundWorkspace(input);
  if (!workspace) throw new Error("声音方案尚未开始");
  if (workspace.revision !== input.expectedRevision) {
    return { status: "conflict" as const, revision: workspace.revision };
  }
  const existing = workspace.rows.find(row => row.id === input.rowId);
  if (!existing) throw new Error("声音方案行不存在");
  const isSpeech =
    existing.kind === "dialogue" || existing.kind === "narration";
  const edited = normalizeStorySoundPlanDraft({
    rows: [
      {
        ...existing,
        ...(input.text === undefined ? {} : { text: input.text }),
        ...(input.description === undefined
          ? {}
          : { description: input.description }),
        ...(input.characterId === undefined
          ? {}
          : input.characterId
            ? { characterId: input.characterId }
            : { characterId: undefined }),
        ...(input.startFrame === undefined
          ? {}
          : { startFrame: input.startFrame }),
        ...(input.durationFrames === undefined
          ? {}
          : { durationFrames: input.durationFrames }),
        ...(input.performance === undefined
          ? {}
          : { performance: { ...existing.performance, ...input.performance } }),
        ...(isSpeech &&
        (input.text !== undefined || input.description !== undefined)
          ? { textOrigin: "user_authored" }
          : {}),
      },
    ],
  }).rows[0];
  if (!edited) throw new Error("声音方案行修改无效");
  const draft: StorySoundPlanDraft = {
    globalDirection: workspace.globalDirection,
    rows: workspace.rows.map(row => (row.id === input.rowId ? edited : row)),
    characterVoiceAssignments: workspace.characterVoiceAssignments,
  };
  const saved = await saveStorySoundWorkspace({
    ...input,
    expectedRevision: workspace.revision,
    draft,
    interviewStatus: workspace.interviewStatus,
    currentStepId: workspace.currentStepId,
    restoredFromVersionId: workspace.restoredFromVersionId,
    interviewState: workspace.interviewState,
    selectionByRowId: workspace.selectionByRowId,
  });
  return saved.status === "conflict"
    ? saved
    : { status: "ok" as const, workspace: saved.workspace };
}

export async function setStorySoundPlanRowSelection(input: {
  storyId: number;
  userId: number;
  expectedRevision: number;
  rowId: string;
  selected: boolean;
}) {
  const workspace = await loadStorySoundWorkspace(input);
  if (!workspace) throw new Error("声音方案尚未开始");
  if (workspace.revision !== input.expectedRevision) {
    return { status: "conflict" as const, revision: workspace.revision };
  }
  if (!workspace.rows.some(row => row.id === input.rowId)) {
    throw new Error("声音方案行不存在");
  }
  const saved = await saveStorySoundWorkspace({
    ...input,
    expectedRevision: workspace.revision,
    draft: workspace,
    interviewStatus: workspace.interviewStatus,
    currentStepId: workspace.currentStepId,
    restoredFromVersionId: workspace.restoredFromVersionId,
    interviewState: workspace.interviewState,
    selectionByRowId: {
      ...workspace.selectionByRowId,
      [input.rowId]: input.selected,
    },
  });
  return saved.status === "conflict"
    ? saved
    : { status: "ok" as const, workspace: saved.workspace };
}

export async function buildStorySoundPlanVersion(
  input: { storyId: number; userId: number; expectedRevision: number },
  dependencies: DirectorDependencies = {}
) {
  const workspace = await loadStorySoundWorkspace(input);
  if (!workspace) throw new Error("声音方案尚未开始");
  if (workspace.revision !== input.expectedRevision) {
    return { status: "conflict" as const, revision: workspace.revision };
  }
  let state = normalizeStorySoundInterviewState(workspace.interviewState);
  // Workspaces restored before provenance was preserved have no interview
  // state. Recover the immutable source version metadata so those drafts can
  // still become a new version without bypassing evidence validation.
  if (!state && workspace.restoredFromVersionId) {
    const restoredVersion = await getStorySoundPlanVersion({
      storyId: input.storyId,
      userId: input.userId,
      versionId: workspace.restoredFromVersionId,
    });
    if (restoredVersion) {
      state = {
        schemaVersion: 1,
        evidenceSnapshotDigest: restoredVersion.evidenceSnapshotDigest,
        sourceRevisions: restoredVersion.sourceRevisions,
        questions: [],
        answers: [],
        reviewSuggestions: [],
        currentStepIndex: 0,
        evidenceChanged: false,
      };
    }
  }
  if (!state || state.currentStepIndex < state.questions.length) {
    throw new Error("请先完成声音问答");
  }
  assertInterviewAllowance(input.userId);
  const packet = await (
    dependencies.compileContext ?? compileStorySoundContext
  )(input);
  if (!packet) throw new Error("故事不存在或不属于当前用户");
  if (packet.evidenceSnapshotDigest !== state.evidenceSnapshotDigest) {
    const changedState = {
      ...buildStorySoundInterviewState(packet),
      evidenceChanged: true,
    };
    const groundedRows = workspace.rows.filter(row =>
      row.evidence.every(reference => {
        if (reference.sourceKind === "user_answer") return true;
        return (
          Boolean(reference.revisionHash) &&
          packet.sourceRevisions[reference.id] === reference.revisionHash
        );
      })
    );
    const groundedSelection = Object.fromEntries(
      groundedRows.map(row => [
        row.id,
        workspace.selectionByRowId[row.id] !== false,
      ])
    );
    const saved = await saveStorySoundWorkspace({
      ...input,
      expectedRevision: workspace.revision,
      draft: { ...workspace, rows: groundedRows },
      interviewStatus: "interviewing",
      currentStepId: changedState.questions[0]?.id,
      interviewState: changedState,
      selectionByRowId: groundedSelection,
    });
    if (saved.status === "conflict") return saved;
    return {
      status: "evidence_changed" as const,
      ...publicSession(saved.workspace),
    };
  }
  const version = await saveStorySoundPlanVersion({
    storyId: input.storyId,
    userId: input.userId,
    evidenceSnapshotDigest: state.evidenceSnapshotDigest,
    sourceRevisions: state.sourceRevisions,
  });
  return { status: "ok" as const, version };
}
