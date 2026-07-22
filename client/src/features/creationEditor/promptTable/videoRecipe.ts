import type { CreationEditorShot } from "../CreationEditorContext";
import type { PromptRow } from "./types";
import { promptShotCode } from "@shared/shotIdentity";
import {
  VIDEO_VISUAL_FIDELITY_CLAUSE_EN,
  VIDEO_VISUAL_FIDELITY_CLAUSE_ZH,
} from "@shared/videoMotionPolicy";

export type CompiledVideoShotRecipe = {
  sourceImageUrl?: string;
  finalPrompt: string;
  missing: string[];
  usedDimensions: string[];
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function rowValue(rows: readonly PromptRow[], dimension: string): string {
  return clean(rows.find(row => row.dimension === dimension)?.value);
}

function shotLabel(shot: CreationEditorShot) {
  return promptShotCode(shot);
}

function addLine(lines: string[], label: string, value: string) {
  if (value) lines.push(`${label}：${value}`);
}

export function compileVideoShotRecipe(params: {
  shot: CreationEditorShot;
  rows: readonly PromptRow[];
}): CompiledVideoShotRecipe {
  const { shot, rows } = params;
  const sourceImageUrl =
    clean(shot.imageUrl) || clean(shot.promptRun?.imageUrl);
  const dimensions = [
    "videoPrompt",
    "sceneTitle",
    "sceneArtBrief",
    "subject",
    "action",
    "performance",
    "environmentMotion",
    "cameraMove",
    "cameraHeight",
    "lens",
    "cameraPath",
    "subjectPath",
    "videoStart",
    "videoEnd",
    "transitionIn",
    "transitionOut",
    "dialogue",
    "sound",
    "soundBridge",
    "mood",
    "styleRef",
    "visual_style",
    "color_palette",
    "lighting",
    "colorPalette",
    "materialTexture",
    "composition",
    "material",
    "negative_prompt",
    "art_style_recipe",
    "rationale",
  ];
  const usedDimensions: string[] = [];
  const value = (dimension: string) => {
    const next =
      rowValue(rows, dimension) ||
      clean(shot[dimension as keyof CreationEditorShot]);
    if (next) usedDimensions.push(dimension);
    return next;
  };

  const videoPromptRow = rows.find(row => row.dimension === "videoPrompt");
  const videoPrompt = clean(videoPromptRow?.value) || clean(shot.videoPrompt);
  const sceneTitle = value("sceneTitle");
  const sceneArtBrief = value("sceneArtBrief");
  const subject = value("subject");
  const action = value("action");
  const performance = value("performance");
  const environmentMotion = value("environmentMotion");
  const cameraMove = value("cameraMove");
  const cameraHeight = value("cameraHeight");
  const lens = value("lens");
  const cameraPath = value("cameraPath");
  const subjectPath = value("subjectPath");
  const videoStart = value("videoStart");
  const videoEnd = value("videoEnd");
  const transitionIn = value("transitionIn");
  const transitionOut = value("transitionOut");
  const dialogue = value("dialogue");
  const sound = value("sound");
  const soundBridge = value("soundBridge");
  const mood = value("mood");
  const styleRef = value("styleRef");
  const visualStyle = value("visual_style");
  const colorPalette = value("color_palette") || value("colorPalette");
  const lighting = value("lighting");
  const composition = value("composition");
  const material = value("material") || value("materialTexture");
  const negativePrompt = value("negative_prompt");
  const artStyleRecipe = value("art_style_recipe");
  const rationale = value("rationale");
  const hasCurrentDirection = [
    action,
    performance,
    environmentMotion,
    cameraMove,
    cameraPath,
    subjectPath,
    videoStart,
    videoEnd,
    transitionIn,
    transitionOut,
  ].some(Boolean);
  const useVideoPrompt = Boolean(
    videoPrompt &&
      (videoPromptRow?.source.system === "manual" || !hasCurrentDirection)
  );

  const lines = [
    `图生视频任务：只生成 ${shotLabel(shot)} 的 3-5 秒短片片段。`,
    "使用当前关键帧作为首帧，保持人物、构图、色调和故事上下文一致。",
  ];
  if (useVideoPrompt) {
    addLine(lines, "核心视频提示", videoPrompt);
    usedDimensions.push("videoPrompt");
  }
  addLine(
    lines,
    "场次",
    [clean(shot.sceneNo), sceneTitle].filter(Boolean).join(" · ")
  );
  addLine(lines, "场景美术库", sceneArtBrief);
  addLine(lines, "镜头要传达的信息", clean(shot.intent) || rationale);
  addLine(lines, "主体", subject);
  addLine(lines, "动作", action);
  addLine(lines, "表演", performance);
  addLine(lines, "环境变化", environmentMotion);
  addLine(
    lines,
    "机位与焦段",
    [cameraHeight, lens].filter(Boolean).join(" · ")
  );
  addLine(
    lines,
    "相机运动",
    cameraPath || cameraMove || "稳定轻微运动，避免夸张转场"
  );
  addLine(lines, "主体运动路径", subjectPath);
  addLine(lines, "起始画面", videoStart);
  addLine(lines, "结束状态", videoEnd);
  addLine(lines, "接上一镜", transitionIn);
  addLine(lines, "接下一镜", transitionOut);
  addLine(lines, "字幕/旁白含义", dialogue);
  addLine(lines, "背景音", sound);
  addLine(lines, "声音桥", soundBridge);
  addLine(lines, "情绪色调", mood);
  addLine(lines, "美术配方", artStyleRecipe);
  addLine(
    lines,
    "美术风格",
    [styleRef, visualStyle].filter(Boolean).join("\n")
  );
  addLine(lines, "色彩基调", colorPalette);
  addLine(lines, "灯光", lighting);
  addLine(lines, "构图", composition);
  addLine(lines, "材质", material);
  lines.push(`画面保真：${VIDEO_VISUAL_FIDELITY_CLAUSE_ZH}`);
  lines.push(
    "限制：不要生成文字水印，不要把字幕画进画面，不要新增事实，不要励志海报感。"
  );
  lines.push(
    `Negative: ${[
      "no floating objects, no gravity-defying elements, birds fly only in sky not on ground, characters obey physics, no impossible poses, no melting or warping of solid objects",
      VIDEO_VISUAL_FIDELITY_CLAUSE_EN,
      negativePrompt,
    ]
      .filter(Boolean)
      .join(", ")}.`
  );

  const missing: string[] = [];
  if (!sourceImageUrl) missing.push("首帧图");
  if (!useVideoPrompt && !action && !cameraMove && !cameraPath)
    missing.push("视频运动提示");

  return {
    sourceImageUrl: sourceImageUrl || undefined,
    finalPrompt: lines.filter(Boolean).join("\n"),
    missing,
    usedDimensions: Array.from(
      new Set(
        usedDimensions.filter(dimension => dimensions.includes(dimension))
      )
    ),
  };
}
