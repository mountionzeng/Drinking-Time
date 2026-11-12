/** Explicit work-scoped commands, shared by UI routing and server persistence.
 * Keep this tiny: chat routing must not import the emotion taxonomy or analyze a person. */
export type CreationEmotionCommand =
  | { action: "set"; shotNo?: number; raw: string }
  | { action: "show"; shotNo?: number };
export function parseCreationEmotionChat(
  message: string
): CreationEmotionCommand | null {
  const text = message.trim();
  const target = String.raw`(?:(?:这个|这部)?(?:作品|故事|影片)|第(\d+)镜)`;
  const set = text.match(
    new RegExp(
      String.raw`^(?:请)?(?:把|将|我希望)?${target}(?:的)?(?:情绪|氛围)(?:设为|改为|改成|设置为|是|[：:])\s*[：:]?\s*([\s\S]+)$`,
      "u"
    )
  );
  if (set)
    return {
      action: "set",
      ...(set[1] ? { shotNo: Number(set[1]) } : {}),
      raw: set[2].trim(),
    };
  const show = text.match(
    new RegExp(
      String.raw`^(?:查看|显示|看看)${target}(?:的)?情绪(?:设定|历史)?[。？?]?$`,
      "u"
    )
  );
  return show
    ? { action: "show", ...(show[1] ? { shotNo: Number(show[1]) } : {}) }
    : null;
}
