import {
  PUBLISHING_PLATFORM_IDS,
  type PublishingDraftContent,
  type PublishingPlatformId,
} from "../shared/publishingDraft";
import {
  compileConvertPublishingDraftPrompt,
  compileGeneratePublishingDraftPrompt,
  compileRevisePublishingDraftPrompt,
  compileRevisePublishingDraftRepairPrompt,
  preserveAppliedPublishingTitle,
  type PublishingDraftPromptRequest,
} from "../server/services/publishingDraft";
import {
  PUBLISHING_DRAFT_PROMPT_CONTRACTS,
  PUBLISHING_DRAFT_PROMPT_TASK_PATHS,
  type PublishingDraftPromptCase,
  type PublishingDraftPromptContract,
  type PublishingDraftPromptTaskPath,
} from "./publishingDraftPromptCases";

type CompiledPublishingDraftPromptCase = {
  id: string;
  taskPath: PublishingDraftPromptTaskPath;
  description: string;
  input: PublishingDraftPromptCase["input"];
  requiredContracts: PublishingDraftPromptContract[];
  request: PublishingDraftPromptRequest;
};

type PublishingDraftPromptCaseResult = {
  id: string;
  taskPath: PublishingDraftPromptTaskPath;
  description: string;
  systemPrompt: string;
  message: string;
  history: PublishingDraftPromptRequest["history"];
  hardFailures: PublishingDraftPromptContract[];
  diagnostics: string[];
};

export type PublishingDraftPromptContractReport = {
  offline: true;
  provider_call_count: number;
  fixture_schema_failures: number;
  runtime_prompt_path_failures: number;
  hard_invariant_failures: number;
  required_task_path_count: number;
  case_count: number;
  prompt_character_count: number;
  duplicate_instruction_count: number;
  conflicting_instruction_count: number;
  generic_template_risk_count: number;
  unsupported_fact_risk_count: number;
  instruction_precedence_risk_count: number;
  cases: PublishingDraftPromptCaseResult[];
};

export class PublishingDraftPromptCorpusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishingDraftPromptCorpusError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validPlatform(value: unknown): value is PublishingPlatformId {
  return (
    typeof value === "string" &&
    (PUBLISHING_PLATFORM_IDS as readonly string[]).includes(value)
  );
}

function validContent(value: unknown): boolean {
  const content = asRecord(value);
  return (
    !!content &&
    typeof content.title === "string" &&
    nonEmptyString(content.body) &&
    Array.isArray(content.tags) &&
    content.tags.every(tag => typeof tag === "string")
  );
}

function validCore(value: unknown): boolean {
  const core = asRecord(value);
  return (
    !!core &&
    Array.isArray(core.facts) &&
    core.facts.every(nonEmptyString) &&
    nonEmptyString(core.thesis) &&
    typeof core.emotion === "string" &&
    Array.isArray(core.voiceTraits) &&
    core.voiceTraits.every(nonEmptyString) &&
    typeof core.visualConcept === "string"
  );
}

function validateCaseInput(
  taskPath: PublishingDraftPromptTaskPath,
  value: unknown,
  label: string
): void {
  const input = asRecord(value);
  if (!input || !nonEmptyString(input.kind)) {
    throw new PublishingDraftPromptCorpusError(`${label}.input 缺少 kind`);
  }

  if (taskPath === "initial_generation") {
    if (
      input.kind !== "generate" ||
      !validPlatform(input.platform) ||
      !Array.isArray(input.conversation) ||
      input.conversation.length === 0 ||
      !input.conversation.some(turn => {
        const item = asRecord(turn);
        return item?.role === "user" && nonEmptyString(item.content);
      }) ||
      !asRecord(input.narrativeIntent)
    ) {
      throw new PublishingDraftPromptCorpusError(
        `${label}.input 不是有效的首次生成场景`
      );
    }
    return;
  }

  if (taskPath === "platform_conversion") {
    const sourceDraft = asRecord(input.sourceDraft);
    if (
      input.kind !== "convert" ||
      !validCore(input.core) ||
      !sourceDraft ||
      !validPlatform(sourceDraft.platform) ||
      !validContent(sourceDraft.content) ||
      !validPlatform(input.targetPlatform)
    ) {
      throw new PublishingDraftPromptCorpusError(
        `${label}.input 不是有效的平台转换场景`
      );
    }
    return;
  }

  const revisionFieldsValid =
    validCore(input.core) &&
    validContent(input.current) &&
    validPlatform(input.platform) &&
    nonEmptyString(input.instruction);
  if (taskPath === "instructed_revision") {
    if (input.kind !== "revise" || !revisionFieldsValid) {
      throw new PublishingDraftPromptCorpusError(
        `${label}.input 不是有效的指令改写场景`
      );
    }
    return;
  }

  if (
    input.kind !== "revise_repair" ||
    !revisionFieldsValid ||
    !nonEmptyString(input.validationError) ||
    !nonEmptyString(input.invalidOutput)
  ) {
    throw new PublishingDraftPromptCorpusError(
      `${label}.input 不是有效的结构修复场景`
    );
  }
}

export function validatePublishingDraftPromptCases(
  value: unknown
): PublishingDraftPromptCase[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new PublishingDraftPromptCorpusError("固定场景不能为空");
  }

  const ids = new Set<string>();
  value.forEach((rawCase, index) => {
    const label = `cases[${index}]`;
    const promptCase = asRecord(rawCase);
    if (!promptCase) {
      throw new PublishingDraftPromptCorpusError(`${label} 必须是对象`);
    }
    if (!nonEmptyString(promptCase.id) || ids.has(promptCase.id)) {
      throw new PublishingDraftPromptCorpusError(`${label}.id 缺失或重复`);
    }
    ids.add(promptCase.id);
    if (
      !nonEmptyString(promptCase.taskPath) ||
      !(PUBLISHING_DRAFT_PROMPT_TASK_PATHS as readonly string[]).includes(
        promptCase.taskPath
      )
    ) {
      throw new PublishingDraftPromptCorpusError(`${label}.taskPath 无效`);
    }
    if (!nonEmptyString(promptCase.description)) {
      throw new PublishingDraftPromptCorpusError(`${label}.description 为空`);
    }
    if (
      !Array.isArray(promptCase.requiredContracts) ||
      promptCase.requiredContracts.length === 0 ||
      !promptCase.requiredContracts.every(
        contract =>
          typeof contract === "string" &&
          (PUBLISHING_DRAFT_PROMPT_CONTRACTS as readonly string[]).includes(
            contract
          )
      )
    ) {
      throw new PublishingDraftPromptCorpusError(
        `${label}.requiredContracts 无效`
      );
    }
    validateCaseInput(
      promptCase.taskPath as PublishingDraftPromptTaskPath,
      promptCase.input,
      label
    );
  });

  return value as PublishingDraftPromptCase[];
}

function compileCase(
  promptCase: PublishingDraftPromptCase
): CompiledPublishingDraftPromptCase {
  const { input } = promptCase;
  const request = (() => {
    switch (input.kind) {
      case "generate":
        return compileGeneratePublishingDraftPrompt(input);
      case "convert":
        return compileConvertPublishingDraftPrompt(input);
      case "revise":
        return compileRevisePublishingDraftPrompt(input);
      case "revise_repair":
        return compileRevisePublishingDraftRepairPrompt(input);
    }
  })();
  if (!request.systemPrompt.trim() || !request.message.trim()) {
    throw new Error(`${promptCase.id} 编译出空提示词`);
  }
  return { ...promptCase, request };
}

export function compilePublishingDraftPromptCases(
  value: unknown
): CompiledPublishingDraftPromptCase[] {
  return validatePublishingDraftPromptCases(value).map(compileCase);
}

function contractSatisfied(
  artifact: CompiledPublishingDraftPromptCase,
  contract: PublishingDraftPromptContract
): boolean {
  const prompt = artifact.request.systemPrompt;
  switch (contract) {
    case "strict_json":
      return /严格[^\n]{0,20}JSON|只返回 JSON/.test(prompt);
    case "single_platform":
      return /只.{0,16}(当前|一个|目标).{0,8}平台|不得生成其他平台|不要返回其他平台/.test(
        prompt
      );
    case "no_new_facts":
      return /不添加.{0,20}事实|不(?:要|得|能).{0,30}(?:添加|制造).{0,30}(?:事实|经历|数据|结论)|事实、核心判断[^\n]{0,30}不能被改写|共享内核是不可变约束/.test(
        prompt
      );
    case "preserve_viewpoint":
      return /不要削弱批评|不得偷偷弱化核心观点|核心判断[^\n]{0,30}不能被改写或弱化|不能改变事实、观点、情绪或结论/.test(
        prompt
      );
    case "preserve_epistemic_status":
      return /事实(?:的)?确定程度|严格保持[^\n]{0,20}时态|不得升级成已经确认|不把可能或听说改成已经发生/.test(
        prompt
      );
    case "follow_user_instruction":
      return /先准确执行用户这次提出的|用户直接指挥/.test(prompt);
    case "preserve_applied_title": {
      const input = artifact.input;
      if (input.kind !== "revise" && input.kind !== "revise_repair") {
        return false;
      }
      const candidate: PublishingDraftContent = {
        title: "模型试图替换的标题",
        body: input.current.body,
        tags: [...input.current.tags],
      };
      const result = preserveAppliedPublishingTitle(
        candidate,
        input.current,
        input.platform
      );
      return input.platform === "x"
        ? result.title === candidate.title
        : result.title === input.current.title;
    }
    case "visual_concept_is_not_copy_direction":
      return /visualConcept[^\n]{0,80}(?:不(?:得|能).{0,12}正文|只用于.{0,12}(?:美术|视觉|封面)|不得反向主导)/i.test(
        prompt
      );
    case "structure_only_repair":
      return /只修复(?:一次)?(?:上次候选结果|结构和平台长度)/.test(prompt);
    case "preserve_candidate_content":
      return /不(?:得|要)改(?:写|变)(?:候选|原稿|内容|措辞)|保持.{0,12}(?:内容|措辞).{0,8}不变|只调整.{0,12}不改内容/.test(
        prompt
      );
  }
}

function countDuplicateInstructions(systemPrompt: string): number {
  const counts = new Map<string, number>();
  for (const line of systemPrompt.split("\n")) {
    const normalized = line
      .trim()
      .replace(/[，。！？：；、“”‘’（）【】\s]/g, "")
      .toLocaleLowerCase();
    if (normalized.length < 8) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return Array.from(counts.values()).reduce(
    (total, count) => total + Math.max(0, count - 1),
    0
  );
}

function countGenericTemplateRisks(systemPrompt: string): number {
  const patterns = [
    /人的基本诉求/g,
    /值得停留的反差/g,
    /鲜明的个人判断/g,
    /开头先给钩子/g,
    /视觉感强的短开头/g,
  ];
  return patterns.reduce(
    (total, pattern) => total + (systemPrompt.match(pattern)?.length ?? 0),
    0
  );
}

function hasUnsafeCertaintyInstruction(message: string): boolean {
  return /所有用户|已经证明|必然|确定会|写成已经确认/.test(message);
}

function hasExplicitInstructionBoundary(systemPrompt: string): boolean {
  return /事实边界.{0,12}(?:高于|优先于)用户|用户指令.{0,20}(?:不得|不能).{0,12}(?:改变|捏造|升级)事实/.test(
    systemPrompt
  );
}

export function evaluateCompiledPublishingDraftPromptCases(params: {
  artifacts: CompiledPublishingDraftPromptCase[];
  providerCallCount?: number;
  fixtureSchemaFailures?: number;
  runtimePromptPathFailures?: number;
}): PublishingDraftPromptContractReport {
  const results = params.artifacts.map(artifact => {
    const hardFailures = artifact.requiredContracts.filter(
      contract => !contractSatisfied(artifact, contract)
    );
    const diagnostics: string[] = [];
    if (countGenericTemplateRisks(artifact.request.systemPrompt) > 0) {
      diagnostics.push("generic-template-pressure");
    }
    if (
      hasUnsafeCertaintyInstruction(artifact.request.message) &&
      !hasExplicitInstructionBoundary(artifact.request.systemPrompt)
    ) {
      diagnostics.push("instruction-fact-precedence-implicit");
    }
    return {
      id: artifact.id,
      taskPath: artifact.taskPath,
      description: artifact.description,
      systemPrompt: artifact.request.systemPrompt,
      message: artifact.request.message,
      history: artifact.request.history,
      hardFailures,
      diagnostics,
    };
  });

  const promptCharacterCount = params.artifacts.reduce(
    (total, artifact) =>
      total +
      artifact.request.systemPrompt.length +
      artifact.request.message.length +
      artifact.request.history.reduce(
        (historyTotal, turn) => historyTotal + turn.content.length,
        0
      ),
    0
  );
  const duplicateInstructionCount = params.artifacts.reduce(
    (total, artifact) =>
      total + countDuplicateInstructions(artifact.request.systemPrompt),
    0
  );
  const genericTemplateRiskCount = params.artifacts.reduce(
    (total, artifact) =>
      total + countGenericTemplateRisks(artifact.request.systemPrompt),
    0
  );
  const instructionPrecedenceRiskCount = results.filter(result =>
    result.diagnostics.includes("instruction-fact-precedence-implicit")
  ).length;
  const unsupportedFactRiskCount = results.reduce(
    (total, result) =>
      total +
      result.hardFailures.filter(failure =>
        [
          "no_new_facts",
          "preserve_epistemic_status",
          "visual_concept_is_not_copy_direction",
        ].includes(failure)
      ).length,
    0
  );

  return {
    offline: true,
    provider_call_count: params.providerCallCount ?? 0,
    fixture_schema_failures: params.fixtureSchemaFailures ?? 0,
    runtime_prompt_path_failures: params.runtimePromptPathFailures ?? 0,
    hard_invariant_failures: results.reduce(
      (total, result) => total + result.hardFailures.length,
      0
    ),
    required_task_path_count: new Set(
      params.artifacts.map(artifact => artifact.taskPath)
    ).size,
    case_count: params.artifacts.length,
    prompt_character_count: promptCharacterCount,
    duplicate_instruction_count: duplicateInstructionCount,
    conflicting_instruction_count: instructionPrecedenceRiskCount,
    generic_template_risk_count: genericTemplateRiskCount,
    unsupported_fact_risk_count: unsupportedFactRiskCount,
    instruction_precedence_risk_count: instructionPrecedenceRiskCount,
    cases: results,
  };
}

export function evaluatePublishingDraftPromptCases(
  value: unknown
): PublishingDraftPromptContractReport {
  const cases = validatePublishingDraftPromptCases(value);
  const artifacts: CompiledPublishingDraftPromptCase[] = [];
  let providerCallCount = 0;
  let runtimePromptPathFailures = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    providerCallCount += 1;
    throw new Error(
      "offline publishing prompt evaluation forbids network calls"
    );
  }) as typeof fetch;
  try {
    for (const promptCase of cases) {
      try {
        artifacts.push(compileCase(promptCase));
      } catch {
        runtimePromptPathFailures += 1;
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
  return evaluateCompiledPublishingDraftPromptCases({
    artifacts,
    providerCallCount,
    runtimePromptPathFailures,
  });
}
