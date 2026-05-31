import type { AlmanacDay } from "./almanac";
import type { NayinElement, TodayNayin } from "./nayin";

export interface DailyDrinkPresentation {
  element: NayinElement;
  title: string;
  subtitle: string;
  drinkNote: string;
  motionHint: string;
}

export interface DailyClothingAdvice {
  short: string;
  title: string;
  detail: string;
  tags: string[];
}

export interface DailyActivityAdvice {
  short: string;
  title: string;
  items: string[];
  note: string;
  sourceLabel: string;
}

export const WELCOME_HERO_TITLE = "小酌 · Drinking Time";

export const WELCOME_HERO_SUBTITLE = [
  "倒一杯，随便聊聊。",
  "那些在桌上讲过的八卦、深夜微信里没说完的话、",
  "都是好故事。",
  "在这里，慢慢说。",
].join("\n");

export const DAILY_DRINK_PRESENTATION: Record<
  NayinElement,
  DailyDrinkPresentation
> = {
  metal: {
    element: "metal",
    title: WELCOME_HERO_TITLE,
    subtitle: WELCOME_HERO_SUBTITLE,
    drinkNote: "啤酒 · 金",
    motionHint: "bubble",
  },
  wood: {
    element: "wood",
    title: WELCOME_HERO_TITLE,
    subtitle: WELCOME_HERO_SUBTITLE,
    drinkNote: "龙井 · 木",
    motionHint: "steam",
  },
  water: {
    element: "water",
    title: WELCOME_HERO_TITLE,
    subtitle: WELCOME_HERO_SUBTITLE,
    drinkNote: "椰汁 · 水",
    motionHint: "tide",
  },
  fire: {
    element: "fire",
    title: WELCOME_HERO_TITLE,
    subtitle: WELCOME_HERO_SUBTITLE,
    drinkNote: "大红袍 · 火",
    motionHint: "ripple",
  },
  earth: {
    element: "earth",
    title: WELCOME_HERO_TITLE,
    subtitle: WELCOME_HERO_SUBTITLE,
    drinkNote: "咖啡 · 土",
    motionHint: "swirl",
  },
};

export function getDailyDrinkPresentation(element: NayinElement) {
  return DAILY_DRINK_PRESENTATION[element];
}

const ELEMENT_CLOTHING: Record<
  NayinElement,
  { accent: string; detail: string; tag: string }
> = {
  metal: {
    accent: "干净浅色或一点金属配饰",
    detail: "利落一点会更贴今天的金气。",
    tag: "浅色利落",
  },
  wood: {
    accent: "棉麻、绿色或自然纹理",
    detail: "让材质轻一点，给身体留出舒展感。",
    tag: "棉麻自然",
  },
  water: {
    accent: "蓝白、宽松或垂坠感单品",
    detail: "少一点束缚，适合把节奏放柔。",
    tag: "蓝白清爽",
  },
  fire: {
    accent: "暖色点缀和透气面料",
    detail: "保留一点明亮感，但别让身体闷住。",
    tag: "暖色点缀",
  },
  earth: {
    accent: "米咖色、柔软层次或帆布材质",
    detail: "稳一点、舒服一点，今天更容易沉下来。",
    tag: "米咖层次",
  },
};

const ELEMENT_ACTIVITIES: Record<
  NayinElement,
  { title: string; items: string[]; note: string }
> = {
  metal: {
    title: "先做取舍",
    items: ["整理素材", "定规则", "删掉多余镜头"],
    note: "金气适合把边界切清楚，先收束再展开。",
  },
  wood: {
    title: "让想法生长",
    items: ["开脑洞", "写故事线", "找人物动机"],
    note: "木气适合从一个小线索往外长，不急着定死。",
  },
  water: {
    title: "顺着情绪聊开",
    items: ["访谈聊天", "整理回忆", "找情绪线"],
    note: "水气适合听见暗流，先把故事讲顺。",
  },
  fire: {
    title: "把画面点亮",
    items: ["定主视觉", "推进决策", "试一版高能镜头"],
    note: "火气适合让重点亮起来，先抓住最有温度的一幕。",
  },
  earth: {
    title: "把结构安顿好",
    items: ["归档素材", "复盘脉络", "打磨分镜结构"],
    note: "土气适合承托细节，先把东西放稳。",
  },
};

function seasonalClothing(month: number) {
  if (month <= 2 || month === 12) {
    return {
      short: "保暖外套",
      title: "保暖外套加柔软内搭",
      detail: "早晚温差容易咬人，围巾或帽子可以备着。",
      tag: "冬日保暖",
    };
  }
  if (month <= 4) {
    return {
      short: "薄外套",
      title: "薄外套加透气内搭",
      detail: "春天温度跳得快，方便穿脱比厚重更重要。",
      tag: "春日层次",
    };
  }
  if (month <= 5) {
    return {
      short: "短袖或薄衬衫",
      title: "短袖或薄衬衫，备轻薄外搭",
      detail: "午后会偏暖，通勤或夜间留一层余地。",
      tag: "初夏轻薄",
    };
  }
  if (month <= 8) {
    return {
      short: "清爽短袖",
      title: "清爽短袖、防晒和透气面料",
      detail: "热意明显，轻薄、吸汗和防晒更舒服。",
      tag: "夏日清爽",
    };
  }
  if (month <= 10) {
    return {
      short: "长袖薄外套",
      title: "长袖或薄外套，留一点层次",
      detail: "秋天适合轻装叠穿，早晚再加一件。",
      tag: "秋日叠穿",
    };
  }
  return {
    short: "针织或夹克",
    title: "针织、夹克或稍厚外套",
    detail: "风感会更明显，外层挡风比单纯加厚更稳。",
    tag: "入冬挡风",
  };
}

function uniqueItems(items: string[]) {
  return Array.from(new Set(items.map(item => item.trim()).filter(Boolean)));
}

export function formatLunarDate(today: TodayNayin) {
  const year = today.lunar.yearGanzhi ? `${today.lunar.yearGanzhi}年` : "";
  return `农历${year}${today.lunar.monthCn}${today.lunar.dayCn}`;
}

export function getDailyClothingAdvice(today: TodayNayin): DailyClothingAdvice {
  const season = seasonalClothing(today.cstDate.m);
  const element = ELEMENT_CLOTHING[today.element];
  return {
    short: `穿${season.short}`,
    title: `${season.title}，${element.accent}`,
    detail: `${season.detail}${element.detail}出门前再按实时天气加减一层。`,
    tags: [season.tag, element.tag],
  };
}

export function getDailyActivityAdvice(
  today: TodayNayin,
  almanac: AlmanacDay | null | undefined
): DailyActivityAdvice {
  const element = ELEMENT_ACTIVITIES[today.element];
  const almanacYi =
    almanac && (almanac.status === "ok" || almanac.status === "partial")
      ? almanac.yi.slice(0, 3)
      : [];
  const items = uniqueItems([...almanacYi, ...element.items]).slice(0, 5);
  const shortItems = items.slice(0, 2).join("、");

  return {
    short: shortItems ? `宜${shortItems}` : `宜${element.items[0]}`,
    title: almanacYi.length ? "黄历宜事先行，创作跟上" : element.title,
    items,
    note: almanacYi.length
      ? `${element.note}黄历宜事可以当作今天的行动提示。`
      : element.note,
    sourceLabel: almanacYi.length ? "黄历宜事 + 纳音创作建议" : "纳音创作建议",
  };
}

export function formatTodayIdentity(today: TodayNayin) {
  return [
    today.cstDateStr,
    formatLunarDate(today),
    `${today.ganzhi}日`,
    today.nayinName,
  ].join(" · ");
}
