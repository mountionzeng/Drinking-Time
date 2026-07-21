export const VIDEO_VISUAL_FIDELITY_POLICY_VERSION = 1;

export const VIDEO_VISUAL_FIDELITY_CLAUSE_EN =
  "Treat the supplied source frames as visual truth. Preserve every visible person's identity, face, hairstyle, body, clothing, every prop and object, object count and placement, background geometry, composition, lighting, colors, materials, surface texture, brushwork, and edge detail through the intended motion. Do not add, remove, duplicate, replace, redesign, morph, or reveal anything unless the shot instruction explicitly requests that exact change.";

export const VIDEO_VISUAL_FIDELITY_CLAUSE_ZH =
  "以锁定的源图片为视觉事实：人物身份、脸、发型、身体、服装，以及所有道具和物体、物体数量与位置、背景空间结构、构图、光线、色彩、材质、表面纹理、笔触和边缘细节都必须连续保留。除非镜头文字明确要求某项具体变化，否则不得新增、删除、复制、替换、重设计、融化变形或凭空显露任何内容。";

export type LocalCameraMotion = {
  kind: "hold" | "zoom" | "pan" | "zoom-pan";
  zoomStart: number;
  zoomEnd: number;
  panStartX: number;
  panStartY: number;
  panEndX: number;
  panEndY: number;
};

export type VideoRenderDecision = {
  strategy: "local-transform" | "paid-302";
  reason: string;
  localMotion: LocalCameraMotion | null;
};

export type VideoMotionDecisionInput = Partial<{
  action: string;
  performance: string;
  environmentMotion: string;
  cameraMove: string;
  cameraPath: string;
  subjectPath: string;
  videoStart: string;
  videoEnd: string;
  videoPrompt: string;
}>;

const SIMPLE_CAMERA_PATTERN =
  /数码(?:放大|缩小|推近|拉远)|放大(?:画面|构图)?|缩小(?:画面|构图)?|画面(?:向)?(?:左|右|上|下)移|位置(?:向)?(?:左|右|上|下)?移动|移动(?:一下|一点|少许)?(?:画面|构图|镜头)?位置|调整(?:画面|构图|镜头)?位置|向?(?:左|右|上|下)(?:轻微|一点|少许)?移动|平移(?:画面)?|重新构图|重构图|裁切|定格|固定(?:画面|镜头|机位)|digital\s+zoom|zoom\s+(?:in|out)|pan\s+(?:left|right|up|down)|reframe|reposition|scale\s+(?:up|down)|locked[-\s]?off|static\s+(?:frame|shot)/i;

const COMPLEX_CAMERA_PATTERN =
  /推轨|拉轨|摄影车|滑轨|摇摄|俯仰|跟拍|跟随|追随|环绕|绕拍|旋转|升降|摇臂|手持|肩扛|视差|轨道镜头|dolly|truck|tracking|follow|orbit|crane|jib|handheld|shoulder|parallax|arc\s+(?:left|right)|roll\s+camera/i;

const VISIBLE_CHANGE_PATTERN =
  /走|跑|冲|追|转身|转头|回头|抬手|抬头|抬腿|低头|伸手|张开|闭上|睁开|眨眼|呼吸|说话|开口|哭|笑|触碰|抓住|推开|拉开|撑开|弯腰|起身|坐下|躺下|倒下|坠落|飞过|游动|摇摆|飘动|流动|燃烧|冒烟|生长|裂开|破碎|折叠|扩张|收缩|变形|变成|出现|消失|进入|离开|穿过|落下|升起|下沉|包围|风吹|下雨|波动|晃动|主体移动|人物移动|环境变化|actor\s+(?:moves|walks|runs|turns|raises|opens|closes|breathes|blinks)|woman\s+(?:moves|walks|runs|turns|raises|opens|closes|breathes|blinks)|man\s+(?:moves|walks|runs|turns|raises|opens|closes|breathes|blinks)|subject\s+(?:moves|walks|runs|turns|raises|opens|closes)|background\s+(?:moves|changes|morphs)|environment\s+(?:moves|changes|morphs)|morphs?|transforms?|appears?|disappears?/i;

function motionText(values: Array<string | null | undefined>): string {
  return values
    .map(value => value?.trim() ?? "")
    .filter(Boolean)
    .join("；");
}

function localCameraMotion(cameraText: string): LocalCameraMotion {
  const zoomOut = /缩小|拉远|zoom\s+out|scale\s+down/i.test(cameraText);
  const zoomIn = /放大|推近|zoom\s+in|scale\s+up/i.test(cameraText);
  const left = /向?左移|pan\s+left/i.test(cameraText);
  const right = /向?右移|pan\s+right/i.test(cameraText);
  const up = /向?上移|pan\s+up/i.test(cameraText);
  const down = /向?下移|pan\s+down/i.test(cameraText);
  const genericPan =
    /平移|位置移动|移动.*位置|调整.*位置|reframe|reposition/i.test(
      cameraText
    ) &&
    !left &&
    !right &&
    !up &&
    !down;
  const hasPan = left || right || up || down || genericPan;
  const hasZoom = zoomIn || zoomOut;
  const panScale = hasPan && !hasZoom ? 1.12 : 1;
  return {
    kind:
      hasZoom && hasPan
        ? "zoom-pan"
        : hasZoom
          ? "zoom"
          : hasPan
            ? "pan"
            : "hold",
    zoomStart: zoomOut ? 1.14 : panScale,
    zoomEnd: zoomIn ? 1.14 : panScale,
    panStartX: right ? -0.8 : left || genericPan ? 0.8 : 0,
    panStartY: down ? -0.8 : up ? 0.8 : 0,
    panEndX: right ? 0.8 : left || genericPan ? -0.8 : 0,
    panEndY: down ? 0.8 : up ? -0.8 : 0,
  };
}

export function decideVideoRenderStrategy(
  input: VideoMotionDecisionInput
): VideoRenderDecision {
  const cameraText = motionText([
    input.cameraMove,
    input.cameraPath,
    input.videoPrompt,
  ]);
  const visibleChangeText = motionText([
    input.action,
    input.performance,
    input.environmentMotion,
    input.subjectPath,
    input.videoStart,
    input.videoEnd,
    input.videoPrompt,
  ]);
  if (COMPLEX_CAMERA_PATTERN.test(cameraText)) {
    return {
      strategy: "paid-302",
      reason: "镜头要求真实机位运动、视差或手持响应，需要生成模型补足新画面。",
      localMotion: null,
    };
  }
  if (VISIBLE_CHANGE_PATTERN.test(visibleChangeText)) {
    return {
      strategy: "paid-302",
      reason: "主体、表演或环境会发生可见变化，需要生成新像素。",
      localMotion: null,
    };
  }
  if (!SIMPLE_CAMERA_PATTERN.test(cameraText)) {
    return {
      strategy: "paid-302",
      reason: "镜头意图不只是明确的缩放、平移或定格，保留 302 生成。",
      localMotion: null,
    };
  }
  return {
    strategy: "local-transform",
    reason: "只需要缩放、平移、重新构图或定格，本地剪辑即可完成。",
    localMotion: localCameraMotion(cameraText),
  };
}

export function withVideoVisualFidelity(prompt: string): string {
  const value = prompt.trim();
  if (!value) return VIDEO_VISUAL_FIDELITY_CLAUSE_EN;
  if (value.includes(VIDEO_VISUAL_FIDELITY_CLAUSE_EN)) return value;
  return `${value}\n${VIDEO_VISUAL_FIDELITY_CLAUSE_EN}`;
}
