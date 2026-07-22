import { createHash } from "node:crypto";

import { withVideoVisualFidelity } from "../../shared/videoMotionPolicy";

export const VIDEO_PROMPT_ENGINEERING_VERSION =
  "video-prompt-engineering/v1" as const;

export type VideoPromptEngineeringShot = Partial<{
  shotType: string;
  cameraAngle: string;
  cameraHeight: string;
  lens: string;
  intent: string;
  subject: string;
  action: string;
  performance: string;
  environmentMotion: string;
  cameraMove: string;
  cameraPath: string;
  subjectPath: string;
  videoStart: string;
  videoEnd: string;
  dialogue: string;
  transitionIn: string;
  transitionOut: string;
  transitionIntent: string;
  videoPrompt: string;
  negativePrompt: string;
}>;

export type VideoPromptEngineering = {
  version: typeof VIDEO_PROMPT_ENGINEERING_VERSION;
  cueCode: string;
  narrativeBeat: string;
  editorHardConstraints: string;
  continuityIn: string;
  threeBeatMotion: string;
  cameraPlan: string;
  continuityOut: string;
  preservationPlan: string;
  negativeConstraints: string;
  deterministicPrompt: string;
  finalPrompt: string;
  source: "deterministic" | "vision-directed" | "editor-approved";
  fingerprint: string;
};

export type VideoPromptEngineeringInput = {
  shotNo: number;
  cueCode?: string;
  draftPrompt: string;
  fallbackPrompt: string;
  subtitle?: string;
  previousReferenceNote?: string;
  nextReferenceNote?: string;
  currentShot?: VideoPromptEngineeringShot;
  previousShot?: VideoPromptEngineeringShot;
  nextShot?: VideoPromptEngineeringShot;
};

function clean(value: unknown, max = 600): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

function cleanDraft(value: unknown, max = 1_200): string {
  if (typeof value !== "string") return "";
  return value
    .split(/\r?\n/)
    .filter(
      line =>
        !/^\s*(?:连续性参考|前一镜参考图|后一镜参考图)[：:]/.test(line)
    )
    .join(" ")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function values(...items: unknown[]): string[] {
  return items.map(item => clean(item)).filter(Boolean);
}

function join(items: unknown[], fallback: string): string {
  const resolved = values(...items);
  return resolved.length > 0 ? resolved.join("；") : fallback;
}

function first(items: unknown[], fallback: string): string {
  for (const item of items) {
    const resolved = cleanDraft(item);
    if (resolved) return resolved;
  }
  return fallback;
}

function cameraRig(cameraText: string): string {
  if (/手持|肩扛|handheld|shoulder/i.test(cameraText)) {
    return "受控手持或轻型肩扛，保持低频低幅度的身体响应，结尾前主动收稳";
  }
  if (/跟|追|侧移|横移|环绕|tracking|follow|orbit/i.test(cameraText)) {
    return "三轴稳定器或短滑轨，沿主体或道具的明确路径运动并产生真实视差";
  }
  if (/摇|俯仰|pan|tilt/i.test(cameraText)) {
    return "三脚架配液压云台，只执行受控摇摄或俯仰，不漂移机位";
  }
  if (/升|降|crane|jib|boom/i.test(cameraText)) {
    return "小型摇臂或稳定升降支撑，沿单一垂直弧线缓入缓出";
  }
  if (/推|拉|后撤|dolly|slider|zoom/i.test(cameraText)) {
    return "短滑轨或小型摄影车，以真实位移完成推进或后撤，不用数码缩放冒充运镜";
  }
  return "锁定三脚架为基准，只在主体或道具动作发生后做一次有动机的摄影机响应";
}

function fingerprint(finalPrompt: string): string {
  return createHash("sha256").update(finalPrompt).digest("hex").slice(0, 24);
}

export function compileVideoPromptEngineering(
  input: VideoPromptEngineeringInput
): VideoPromptEngineering {
  const current = input.currentShot ?? {};
  const previous = input.previousShot ?? {};
  const next = input.nextShot ?? {};
  const currentDirection = values(
    current.action,
    current.performance,
    current.environmentMotion,
    current.cameraMove,
    current.cameraPath,
    current.subjectPath,
    current.videoStart,
    current.videoEnd,
    current.transitionIn,
    current.transitionOut
  );
  const editorIntent =
    currentDirection.length > 0
      ? join(
          [
            current.action,
            current.performance,
            current.environmentMotion,
            current.subjectPath,
            current.cameraMove,
            current.cameraPath,
            current.videoEnd,
          ],
          clean(input.draftPrompt) || clean(input.fallbackPrompt)
        )
      : join(
          [
            first(
              [current.videoPrompt, input.draftPrompt, input.fallbackPrompt],
              ""
            ),
          ],
          "保持锁定画面，只做自然呼吸和一次有动机的摄影机响应"
        );
  const narrativeBeat = join(
    [current.intent, input.subtitle, current.dialogue],
    "让这一镜的动作服务当前叙事节拍，不把台词直接画进画面"
  );
  const continuityIn = join(
    [
      previous.videoEnd,
      previous.transitionOut,
      current.transitionIn,
      input.previousReferenceNote,
    ],
    "从锁定首帧的构图、视线和动作状态开始，不凭空改变空间关系"
  );
  const continuityOut = join(
    [
      current.videoEnd,
      current.transitionOut,
      next.transitionIn,
      next.videoStart,
      next.intent,
      input.nextReferenceNote,
    ],
    "动作与摄影机共同减速，在可直接剪入下一镜的构图和动势上停住"
  );
  const startState = clean(current.videoStart) || "锁住首帧构图";
  const action = join(
    [current.action, current.performance, current.subjectPath],
    editorIntent
  );
  const response = clean(current.environmentMotion)
    ? `主体发生接触或完成发力后，环境才回应：${clean(current.environmentMotion)}`
    : "主体发生接触或完成发力后，只有用户明确点名的可见元素才允许回应，其余物体保持固定";
  const threeBeatMotion = [
    `起势 0-25%：${startState}；先由视线、呼吸和重心建立动作意图，四肢不独立漂浮`,
    `发展 25-75%：${action}；${response}`,
    `收束 75-100%：${continuityOut}`,
  ].join("；");
  const explicitCamera = join(
    [
      current.shotType,
      current.cameraAngle,
      current.cameraHeight,
      current.lens,
      current.cameraMove,
      current.cameraPath,
    ],
    ""
  );
  const rig = cameraRig(explicitCamera);
  const cameraPlan = explicitCamera
    ? `${rig}；执行：${explicitCamera}；摄影机由主体或道具动作触发，稍后响应，不无目的漂移`
    : `${rig}；人物动作先发生，摄影机稍后响应，并与人物同时收稳`;
  const preservationPlan =
    "锁定首尾帧中的人物、脸、发型、服装、道具数量和位置、空间几何、构图、光线、色彩、材质、纹理、笔触与边缘；未被用户明确要求的内容不得变化";
  const negativeConstraints = join(
    [current.negativePrompt],
    "不新增、删除、复制或替换人物和物体；不生成字幕、可读文字、UI、水印；不做无因果的漂移、缩放或肢体变形"
  );
  const cueCode = clean(input.cueCode) || `SH${String(input.shotNo).padStart(2, "0")}`;
  const deterministicPrompt = withVideoVisualFidelity(
    [
      `Editor hard constraints: ${editorIntent}`,
      `Preservation: ${preservationPlan}`,
      `Causal three-beat motion: ${threeBeatMotion}`,
      `Camera plan: ${cameraPlan}`,
      `Continuity in: ${continuityIn}`,
      `Continuity out: ${continuityOut}`,
      `Negative constraints: ${negativeConstraints}`,
      `Shot ${cueCode}. Narrative beat: ${narrativeBeat}`,
    ].join("\n")
  );
  return {
    version: VIDEO_PROMPT_ENGINEERING_VERSION,
    cueCode,
    narrativeBeat,
    editorHardConstraints: editorIntent,
    continuityIn,
    threeBeatMotion,
    cameraPlan,
    continuityOut,
    preservationPlan,
    negativeConstraints,
    deterministicPrompt,
    finalPrompt: deterministicPrompt,
    source: "deterministic",
    fingerprint: fingerprint(deterministicPrompt),
  };
}

export function finalizeVideoPromptEngineering(
  engineering: VideoPromptEngineering,
  directedPrompt: string,
  source: VideoPromptEngineering["source"]
): VideoPromptEngineering {
  const authored = clean(directedPrompt, 2_400);
  const finalPrompt =
    source === "editor-approved"
      ? authored || engineering.deterministicPrompt
      : authored
    ? withVideoVisualFidelity(
        [
          `Editor hard constraints that must remain: ${engineering.editorHardConstraints}`,
          `Preserve the locked source-frame identity, objects, composition, color, material and texture; add nothing unless explicitly requested.`,
          authored,
          `Continuity exit that must remain: ${engineering.continuityOut}`,
        ].join("\n")
      )
    : engineering.deterministicPrompt;
  return {
    ...engineering,
    finalPrompt,
    source,
    fingerprint: fingerprint(finalPrompt),
  };
}
