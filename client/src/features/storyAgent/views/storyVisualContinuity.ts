/**
 * 故事级视觉一致性规格 —— 角色、服装、材质、配色、运动规则。
 *
 * 这些是「改一张图时不能被改掉的东西」。以前没有这样一份文件，服装和画风的
 * 描述散落在一段写死的模板里，既没法复用，也和用户当次的动作要求打架。
 *
 * 规格文本不是凭空写的：是照着该故事已确认的画面一格格量出来的（SheSelf02 的
 * 裙子结构取自镜头 0202 的 #1554），并且经过真实出图验证。改这里之前先看图。
 */

export type StoryVisualContinuitySpec = {
  /** 精确匹配 stories.title */
  storyTitle: string;
  /** 只在这些镜号上启用；空数组表示整个故事都启用 */
  cueCodes: readonly string[];
  label: string;
  character: string;
  wardrobe: string;
  texture: string;
  palette: string;
  /** 动作只写「不能怎样」，具体动作永远由用户当次的图片要求决定 */
  motion: string;
};

/**
 * SheSelf02 的白裙是硬挺的窄柱形，不是会飘的软裙 —— 这一条最容易被模型改错：
 * 只要指令里出现「旋转」，模型就会自动把裙子甩成伞面。
 */
export const SHE_SELF_02_CONTINUITY: StoryVisualContinuitySpec = {
  storyTitle: "SheSelf02",
  cueCodes: [],
  label: "SheSelf02 · 人物与白裙连续性",
  character:
    "同一位短黑发女性：齐下颌的黑色短发、背对镜头的关系、身体比例和脸型都保持当前镜头图像里的样子。场景、机位、景别、构图和画幅同样以当前镜头图像为准。",
  wardrobe:
    "白色绸缎露背无袖裙 —— 女主贯穿全片穿的是同一条裙子，认这几条：" +
    "无袖，细肩带搭在肩上；背部大开，从后颈一路开成深 V 直到腰际，整片后背裸露；" +
    "前身简洁合身、无花边无装饰无腰带；腰部只有轻微收束，上下是一整片连续的布。" +
    "绝不是长袖、不是高领、不是船形领、不是包住后背的款式。" +
    "【裙长】以当前镜头画面里的实际长度为准，本规格不规定长短；" +
    "只有当用户这次明确要求改长或改短时才改，并按要求改到位。",
  texture:
    "裙子的材质是**白色绸缎／真丝**：轻薄、柔软、有流动感，表面有柔和的丝光高光和随褶皱起伏的明暗过渡，垂坠时形成细长的斜向褶。绝不是石膏、纸板、粗麻、蕾丝、雪纺网纱或厚涂颜料堆出来的硬壳。【但画面本身仍是手绘的】整幅画保持故事一贯的手工绘画质感：可见画布织纹、笔触、干刷边缘、颗粒感的暗部和轻微套色偏差；禁止光滑照片写实、CG／3D 塑料光泽、柔焦发光的数字质感和 airbrush。也就是说：用绘画的笔触去画一块绸缎，既要看得出是画的，也要看得出这块料子是滑的、会反光、会流动。",
  palette:
    "低饱和的冷调：冷黑与蓝黑的暗部，纯正的红色地面光在人物脚下积聚成一滩光池。" +
    "投影画面的颜色原样保留当前镜头图像自己的色调 —— 红色投影就保持红色，不许换成冷绿。" +
    "整幅画不要偏黄偏棕，不要暖褐色的旧油画罩染或做旧清漆感。" +
    "白裙是画面中最亮的冷象牙白块面，丝光高光可以更亮，但不要染成米黄或金色。",
  motion:
    "动作由用户这次的图片要求决定，本规格不指定姿势。绸缎很轻，会随动作流动：" +
    "裙身可以产生流畅的斜向褶和轻微飘动的边缘，不要画成僵硬不动的硬壳。" +
    "【裙长优先于动势】动作不得改变裙子的长度：" +
    "用户要求及地时，无论旋转、行走还是舞动，裙摆最低处都必须垂到脚踝并轻触地面，" +
    "一圈都不许离地，画面里任何位置都不能出现小腿或膝盖，最多只在正中露出一只裸足的脚尖；" +
    "如果动作会把裙摆带起来，就把动作画成刚起势或即将停下的那一刻，让裙摆保持垂落——" +
    "宁可牺牲旋转的幅度，也不能让裙子变短。" +
    "旋转的速度感优先用上半身扭转、头发甩动和裙身表面的斜向褶来表达。",
};

const CONTINUITY_SPECS: readonly StoryVisualContinuitySpec[] = [
  SHE_SELF_02_CONTINUITY,
];

export function findStoryVisualContinuity(
  storyTitle: string | null | undefined,
  cueCode: string | null | undefined
): StoryVisualContinuitySpec | undefined {
  const title = storyTitle?.trim();
  const code = cueCode?.trim();
  if (!title || !code) return undefined;
  return CONTINUITY_SPECS.find(
    spec =>
      spec.storyTitle === title &&
      (spec.cueCodes.length === 0 || spec.cueCodes.includes(code))
  );
}

export function storyVisualContinuityInstruction(
  spec: StoryVisualContinuitySpec
): string {
  return [
    `【连续性规格｜${spec.label}】`,
    `人物与场景：${spec.character}`,
    `服装：${spec.wardrobe}`,
    `质感：${spec.texture}`,
    `配色：${spec.palette}`,
    `动作：${spec.motion}`,
    "除上述连续性要求和用户点名要改的内容之外，人物身份、场景结构、光线方向、构图和画幅全部保持不变。画面不出现文字、水印、签名或多余人物。",
  ].join("\n\n");
}
