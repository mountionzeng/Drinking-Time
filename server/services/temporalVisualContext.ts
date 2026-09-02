type Season = "春季" | "夏季" | "秋季" | "冬季";

const ERA_PATTERNS = [
  /(?:18|19|20)\d{2}年代/,
  /(?:18|19|20)\d{2}年(?!代)/,
  /(?:六十|七十|八十|九十|零零|一零|二零)年代/,
  /先秦|汉代|唐代|宋代|元代|明代|清代|民国|改革开放初期|当代|未来/,
] as const;

const EXPLICIT_SEASONS: Array<[Season, RegExp]> = [
  ["春季", /春天|春季|初春|暮春/],
  ["夏季", /夏天|夏季|盛夏|初夏/],
  ["秋季", /秋天|秋季|深秋|初秋/],
  ["冬季", /冬天|冬季|寒冬|初冬/],
];

const CURRENT_CONTEXT = /当下|现在|今天|此刻|眼下|最近/;
const OPERATIONAL_AFTER_CURRENT =
  /^[\s，,：:。！？]*(?:请|帮|把|给|生成|修改|重做|重新(?:生成|画|做)|我(?:想|要)|我们(?:想|要)|想要|画(?:一|这|那|个|张|出|成|一下)|做(?:一|这|那|个|张|出|成|一下))/;
const NEGATED_TIME_PREFIX =
  /(?:不要|并非|不是|不想|不再|没有|避免|拒绝|禁止|别|无需|不用|不在)\s*[^，。！？\n]{0,18}$/;
const PERSON_PRESENT =
  /人物|男人|女人|男孩|女孩|孩子|老人|年轻人|少年|青年|姑娘|小伙|学生|毕业生|朋友|情侣|夫妻|夫妇|人群|行人|旅客|同事|老师|医生|护士|工人|父母|家人|兄弟|姐妹|母亲|父亲|妈妈|爸爸|爷爷|奶奶|(?:^|[，。！？\s])(?:他|她|他们|她们|我们|我)(?=$|[，。！？\s]|在|正|穿|走|站|坐|看|拿|把|和|与|的)/;
const EXPLICIT_WARDROBE =
  /穿着|身穿|衣服|服装|外套|大衣|羽绒|毛衣|夹克|衬衫|T恤|短袖|长袖|背心|裙|裤|鞋|帽|围巾|校服|西装|礼服|睡衣|工装/;

const SEASON_WARDROBE: Record<Season, string> = {
  春季: "适应温差的轻便分层日常服装",
  夏季: "轻薄透气的夏季日常服装",
  秋季: "带轻外套和自然层次的秋季日常服装",
  冬季: "保暖分层、材质可信的冬季日常服装",
};

function shanghaiDateString(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(part => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function seasonForDate(date: string): Season | null {
  const month = Number(date.match(/^\d{4}-(\d{2})-\d{2}$/)?.[1]);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (month >= 3 && month <= 5) return "春季";
  if (month >= 6 && month <= 8) return "夏季";
  if (month >= 9 && month <= 11) return "秋季";
  return "冬季";
}

export function explicitEraFromText(text: string): string | null {
  return earliestAffirmedMatch(
    ERA_PATTERNS.map(pattern => [null, pattern] as const),
    text
  )?.match ?? null;
}

function decadeGuidance(era: string): string {
  if (era === "当代") {
    return "使用当代生活中真实可见的综合色调、材料与日常衣着，不擅自复古化";
  }
  if (era === "未来") {
    return "只沿用用户已经说明的未来设定，以可观察的材料、结构和色调表达，不堆叠艺术家姓名或通用霓虹符号";
  }
  const numericYear = Number(era.match(/(?:18|19|20)\d{2}/)?.[0]);
  const numericDecade = Number.isInteger(numericYear)
    ? Math.floor(numericYear / 10) * 10
    : null;
  if (numericDecade === 1960 || /六十年代/.test(era)) {
    return "使用克制印刷色、朴素织物与中期现代日常材料，不叠加后来的数码质感";
  }
  if (numericDecade === 1970 || /七十年代/.test(era)) {
    return "使用赭石、芥末黄、橄榄绿等温暖土色与模拟印刷质感，避免现代极净表面";
  }
  if (numericDecade === 1980 || /八十年代/.test(era)) {
    return "使用模拟胶片的综合色彩、较清晰的综合色块与少量高饱和点色，避免当代数码霓虹泛滥";
  }
  if (numericDecade === 1990 || /九十年代/.test(era)) {
    return "使用轻微褪色的暖色、室内荧光的微冷色偏、朴素印刷与模拟胶片材料关系，避免当代数码霓虹";
  }
  if (numericDecade === 2000 || /零零年代/.test(era)) {
    return "使用早期数码相机与消费印刷常见的清亮色点、轻微冷偏和不过度精修的表面";
  }
  if (numericDecade === 2010 || /一零年代/.test(era)) {
    return "使用移动互联网早期常见的清晰综合色彩、日常数码成像与不过度复古的生活材料";
  }
  if (numericDecade === 2020 || /二零年代/.test(era)) {
    return "使用当代真实生活中的自然综合色彩、常见材料和日常衣着，避免把当下自动处理成未来霓虹";
  }
  return "依据该时代真实存在的综合色调、材料、服装轮廓与日常物件表达年代，不直接堆叠艺术家姓名";
}

function earliestAffirmedMatch<T>(
  candidates: ReadonlyArray<readonly [T, RegExp]>,
  text: string
): { value: T; match: string; index: number } | null {
  const matches: Array<{ value: T; match: string; index: number }> = [];
  for (const [value, pattern] of candidates) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    for (const match of text.matchAll(new RegExp(pattern.source, flags))) {
      if (match.index == null) continue;
      const prefix = text.slice(Math.max(0, match.index - 28), match.index);
      if (!NEGATED_TIME_PREFIX.test(prefix)) {
        matches.push({ value, match: match[0], index: match.index });
      }
    }
  }
  return matches.sort((left, right) => left.index - right.index)[0] ?? null;
}

function hasCurrentStoryContext(text: string): boolean {
  const flags = CURRENT_CONTEXT.flags.includes("g")
    ? CURRENT_CONTEXT.flags
    : `${CURRENT_CONTEXT.flags}g`;
  for (const match of text.matchAll(new RegExp(CURRENT_CONTEXT.source, flags))) {
    if (match.index == null) continue;
    const prefix = text.slice(Math.max(0, match.index - 28), match.index);
    const suffix = text.slice(match.index + match[0].length);
    if (
      !NEGATED_TIME_PREFIX.test(prefix) &&
      !OPERATIONAL_AFTER_CURRENT.test(suffix)
    ) {
      return true;
    }
  }
  return false;
}

export function temporalVisualPromptBlock(input: {
  text: string;
  /** 测试与重放可固定日期；运行时默认使用上海时区的当天日期。 */
  currentDate?: string;
  /** 已有参考画面时，衣着属于可见事实，季节不得改写它。 */
  preserveVisibleWardrobe?: boolean;
}): string | null {
  const text = input.text.trim();
  if (!text) return null;

  const era = explicitEraFromText(text);
  const explicitSeason = earliestAffirmedMatch(EXPLICIT_SEASONS, text)?.value ?? null;
  const currentSeason =
    !era && hasCurrentStoryContext(text)
      ? seasonForDate(input.currentDate ?? shanghaiDateString())
      : null;
  const season = explicitSeason ?? currentSeason;
  if (!era && !season) return null;

  const lines = ["【时间、季节与服装】"];
  if (era) {
    lines.push(`明确年代：${era}。${decadeGuidance(era)}。`);
  }
  if (season) {
    if (!PERSON_PRESENT.test(text)) {
      lines.push(
        `明确季节：${season}。只用环境、光线与材质表现${season}，不要凭空添加人物。`
      );
    } else if (input.preserveVisibleWardrobe) {
      lines.push(
        `明确季节：${season}。人物服装以参考画面中的可见事实为准，不补写或替换季节穿着。`
      );
    } else if (EXPLICIT_WARDROBE.test(text)) {
      lines.push(
        `明确季节：${season}。原文已经明确服装，保持原样，不用季节模板替换。`
      );
    } else {
      lines.push(
        `明确季节：${season}。人物采用${SEASON_WARDROBE[season]}，保持生活化并服从场景，不让穿着抢走叙事主体。`
      );
    }
  }
  return lines.join("\n");
}
