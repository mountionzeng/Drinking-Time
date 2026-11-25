export type TrialState =
  | "reference"
  | "source"
  | "quoted"
  | "writing"
  | "ready"
  | "failed";
export type ShotTextTrial = {
  id: string;
  shotId: string;
  source: string;
  state: TrialState;
  text: string;
  request: string;
  createdAt: number;
  parentId?: string;
  retryOf?: string;
  conversationIntent?: Array<{ messageId: string; text: string }>;
  attemptedProvider?: string;
  attemptedModel?: string;
  failureReason?: string;
  failureStatus?: number;
  writingStartedAt?: number;
  retryPolicy?: "same_model" | "other_model" | "other_provider" | "reconcile";
  retryNotBefore?: number;
  billingOperationId?: string;
};
export function shotTextTrialIntent(
  words: string,
  hasTrialContext = false
): {
  shotNo?: number;
  retry?: boolean;
  opening?: boolean;
  revise?: boolean;
} | null {
  const shot = /第\s*(\d+)\s*镜/.exec(words);
  if (
    (hasTrialContext || shot) &&
    /^(?:请|帮我|请帮我)?(?:给第\s*\d+\s*镜)?(?:重试|再试一次|重新报价|换个模型重试)(?:一下|写稿|文字试稿)?[。！!？?]?$/u.test(
      words.trim()
    )
  )
    return { shotNo: shot ? Number(shot[1]) : undefined, retry: true };
  const opening = /(?:写|起草|编)[^。！？\n]{0,26}(?:开场|开头|第一镜)/.test(
    words
  );
  const revise =
    hasTrialContext &&
    /(?:最后|开头|前|后|第)[一二三四五六七八九十两0-9 ]+秒[^。！？\n]{0,35}(?:留给|留白|只听|只留|停住|先看|听见)|(?:把|让|改一下|删掉|缩短|保留)[^。！？\n]{0,25}(?:旁白|台词|稿子|这一句|视线|运镜)/.test(
      words
    );
  if (!opening && !revise && !shot && !/本镜|这一?镜|当前镜头/.test(words))
    return null;
  const written =
    /只(?:给|写|要|做)(?:这[一\d]*镜的)?文字|(?:写|给我|起草|撰写)[^。！？\n]{0,80}文字(?:试稿|草稿)|(?:写|给我|撰写)[^。！？\n]{0,80}(?:提示词|分镜稿|镜头稿|台词稿|旁白稿)/.test(
      words
    );
  if (
    /(?:用|按|按照)[^。！？\n]{0,50}文字试稿[^。！？\n]{0,15}(?:生成|渲染|制作)[^。！？\n]{0,20}(?:视频|图片|声音|音频)/.test(
      words
    )
  )
    return null;
  if (
    !(written || opening || revise) ||
    /(?:^|[，。！？、]\s*)(?:请|帮我|请帮我)?(?:朗读|配音|读出|把.{0,50}读出来|(?:制作|生成|录制)(?:这段|本镜|第\s*\d+\s*镜)?(?:的)?(?:声音|音频|有声书))/.test(
      words
    )
  )
    return null;
  // A separate, affirmative request for an audio asset retains the sound workflow.
  if (
    /然后(?:请)?(?:朗读|配音|生成音频)|并(?:把它读出来|制作声音|生成配音)/.test(
      words
    )
  )
    return null;
  return {
    shotNo: shot ? Number(shot[1]) : undefined,
    ...(opening && !shot ? { opening: true } : {}),
    ...(revise ? { revise: true } : {}),
  };
}
