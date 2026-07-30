export const SHICHEN_NAMES = [
  "子时",
  "丑时",
  "寅时",
  "卯时",
  "辰时",
  "巳时",
  "午时",
  "未时",
  "申时",
  "酉时",
  "戌时",
  "亥时",
] as const;

export type ShichenName = (typeof SHICHEN_NAMES)[number];

export interface ShichenGuidance {
  name: ShichenName;
  range: string;
  phase: string;
  recommended: string;
  avoid: string;
  mindset: string;
  letterAdvice: string;
}

const SHICHEN_GUIDANCE: Record<ShichenName, Omit<ShichenGuidance, "name">> = {
  子时: {
    range: "23:00-00:59",
    phase: "一天收束、身体准备休息",
    recommended: "慢慢收尾",
    avoid: "深夜定大事",
    mindset: "不必在夜里替所有问题收尾",
    letterAdvice:
      "这一段更适合把没说完的话先记下来，让身体慢慢收尾；重要决定可以留到睡醒以后。",
  },
  丑时: {
    range: "01:00-02:59",
    phase: "深夜休息",
    recommended: "先让身体休息",
    avoid: "硬撑想明白",
    mindset: "暂时没有答案也可以先睡一觉",
    letterAdvice:
      "这一段最值得照顾的是睡眠，暂时想不明白的事可以先停在这里，不必靠硬撑换答案。",
  },
  寅时: {
    range: "03:00-04:59",
    phase: "黎明前的安静段",
    recommended: "留住睡意",
    avoid: "强行开新局",
    mindset: "先保护尚未恢复的精力",
    letterAdvice:
      "天还没有真正亮起来，醒着的话先照顾身体和呼吸，不必急着把新一天提前开始。",
  },
  卯时: {
    range: "05:00-06:59",
    phase: "清晨启动",
    recommended: "轻轻启动",
    avoid: "一醒塞太满",
    mindset: "让身体和注意力一起醒来",
    letterAdvice:
      "清晨适合用一个很小的动作启动今天，先让身体和注意力醒来，不用一开始就把日程塞满。",
  },
  辰时: {
    range: "07:00-08:59",
    phase: "上午定调",
    recommended: "先定优先级",
    avoid: "同时开太多",
    mindset: "先把最要紧的一件事放在前面",
    letterAdvice:
      "上午刚展开，先替今天定下一件最要紧的事会更稳，其他事情可以排队，不必同时开场。",
  },
  巳时: {
    range: "09:00-10:59",
    phase: "上午专注段",
    recommended: "专注推进",
    avoid: "频繁切换",
    mindset: "先做完一小段，再决定下一步",
    letterAdvice:
      "这段时间适合把注意力收在一件要紧的事上，先做完一小段；频繁切换可以晚一点。",
  },
  午时: {
    range: "11:00-12:59",
    phase: "上午与午间的转折",
    recommended: "完成再休息",
    avoid: "情绪顶点定论",
    mindset: "允许自己在转折处停一下",
    letterAdvice:
      "到了上午和午间的转折处，可以先完成手边这一小段，再好好吃饭休息；情绪正满的时候不急着定论。",
  },
  未时: {
    range: "13:00-14:59",
    phase: "午后恢复",
    recommended: "留点缓冲",
    avoid: "午后排太满",
    mindset: "把速度调到身体跟得上的位置",
    letterAdvice:
      "午后可以给恢复留一点缓冲，用轻一点的速度继续推进；行程不必排得太满。",
  },
  申时: {
    range: "15:00-16:59",
    phase: "下午收束前",
    recommended: "补齐关键细节",
    avoid: "仓促加新任务",
    mindset: "先把已经开始的事收拢",
    letterAdvice:
      "下午更适合把已经开始的事情收拢、补齐关键细节，新的任务可以先记下，不必仓促加进来。",
  },
  酉时: {
    range: "17:00-18:59",
    phase: "工作与生活交接",
    recommended: "把今天收好",
    avoid: "把工作拖太晚",
    mindset: "允许今天有一个清楚的结束",
    letterAdvice:
      "这会儿适合替今天做一个清楚的收尾，把完成和未完成分开放好，不必让工作一直拖进晚上。",
  },
  戌时: {
    range: "19:00-20:59",
    phase: "晚间缓和",
    recommended: "留一段轻交流",
    avoid: "高压谈争执",
    mindset: "把语气放轻，也给自己留一点余地",
    letterAdvice:
      "晚间适合留一段轻一点的交流或独处，把语气放缓；需要高压处理的争执可以晚一点再谈。",
  },
  亥时: {
    range: "21:00-22:59",
    phase: "休息前收心",
    recommended: "收心做记录",
    avoid: "睡前追答案",
    mindset: "让今天先停在可以休息的位置",
    letterAdvice:
      "休息前可以把还惦记的事简单记下来，让今天停在一个可以睡觉的位置，不必继续追着答案走。",
  },
};

export function shichenFromHour(hour: number): ShichenName {
  const normalized = ((Math.floor(hour) % 24) + 24) % 24;
  const index = normalized === 23 ? 0 : Math.floor((normalized + 1) / 2);
  return SHICHEN_NAMES[index];
}

export function shichenFromTime(value: string): ShichenName | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? shichenFromHour(Number(match[1])) : null;
}

export function currentChinaShichen(now = new Date()): ShichenName {
  const hourPart = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(now)
    .find(part => part.type === "hour");
  return shichenFromHour(Number(hourPart?.value ?? 0));
}

export function shichenGuidance(name: ShichenName): ShichenGuidance {
  return { name, ...SHICHEN_GUIDANCE[name] };
}

export function currentChinaShichenGuidance(now = new Date()) {
  return shichenGuidance(currentChinaShichen(now));
}
