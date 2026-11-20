const numeral = "[0-9一二两三四五六七八九十]+";
function ordinal(token: string) {
  if (/^\d+$/.test(token)) return Number(token);
  const digit = (s: string) =>
    "零一二三四五六七八九".indexOf(s.replace("两", "二"));
  if (!token.includes("十")) return digit(token);
  const [left, right] = token.split("十");
  return (left ? digit(left) : 1) * 10 + (right ? digit(right) : 0);
}

export function cupTypes(text: string) {
  const variants = {
    fire: /红(?:色|茶)?的?小?(?:茶杯|杯|茶壶)|茶壶/u,
    wood: /绿(?:色|茶)?的?小?(?:茶杯|杯)|茶碗/u,
    earth: /咖啡杯|咖啡的小茶杯/u,
    water: /椰汁/u,
    metal: /啤酒杯/u,
  };
  return Object.entries(variants)
    .filter(([, pattern]) => pattern.test(text))
    .map(([kind]) => kind);
}

/** Only explicit picture-to-dialogue requests go ahead of sound generation / image editing. */
export function parseDialogueVisualSync(text: string) {
  if (
    !/(台词|旁白|开口|念到|说到)/u.test(text) ||
    !/(出现|入画|出场|显示|对齐|同步)/u.test(text)
  )
    return null;
  if (
    !/(随着|随.{0,6}(台词|旁白)|跟|伴随|同时|对齐|同步|一[响说开]|说到|念到|时.{0,8}(出现|入画))/u.test(
      text,
    )
  )
    return null;
  const shotPattern = new RegExp(
    "(?:第\\s*)?(" +
      numeral +
      ")\\s*(?:个)?镜(?:头)?|(?:镜头|SH)\\s*(" +
      numeral +
      ")",
    "gi",
  );
  const shotNumbers = new Set(
    Array.from(text.matchAll(shotPattern), (m) => ordinal(m[1] ?? m[2])),
  );
  const line = text.match(new RegExp("第\\s*(" + numeral + ")\\s*句"));
  const quote = text.match(/[“「"]([^”」"]{1,120})[”」"]/u)?.[1]?.trim();
  const image = text.match(/(?:图(?:片)?|素材)\s*#\s*(\d+)/u);
  const event = text.match(
    /(?:原片|原视频|源视频)(?:中|里|的)?\s*第?\s*(\d+(?:\.\d+)?)\s*秒/u,
  );
  const types = cupTypes(text);
  const cup = types.length > 0 || /茶杯|杯子/u.test(text);
  const kinds = types.length
    ? types
    : ["fire", "wood", "earth", "metal", "water"];
  return {
    shotNo: [...shotNumbers][0] ?? null,
    line: line ? ordinal(line[1]) : 1,
    quote,
    imageId: image ? Number(image[1]) : null,
    eventSec: event ? Number(event[1]) : null,
    cup,
    kinds,
    preview:
      /试算|先看看|先预览|先听听|先看效果|先试剪|只预览|别改|不(?:要|用)改|暂不|如果|比方说|举例|能不能|可以吗|[?？]/u.test(
        text,
      ),
    ambiguous:
      types.length > 1 ||
      shotNumbers.size > 1 ||
      /最后一?句|倒数|不要.{0,8}(出现|入画|对齐|同步)|(?:不要|别)(?:再)?提前|第.+镜.{1,30}第.+镜|(?:让|把)(?:这句|第一句)?(?:旁白|台词|声音).{0,12}(?:跟|随|提前|推迟|挪)|修改台词/u.test(
        text,
      ),
  };
}
export type DialogueVisualSync = NonNullable<
  ReturnType<typeof parseDialogueVisualSync>
>;
