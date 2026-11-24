import { z } from "zod";

export const objectTargetsSchema = z.array(z.string().trim().min(1).max(64)).min(1).max(8);
const coordinate = z.number().min(0).max(1);
export const regionBoxSchema = z.tuple([coordinate, coordinate, coordinate, coordinate]);
export const objectRegionSchema = z.object({ label: z.string(), boxes: z.array(regionBoxSchema).max(3) });
export type ObjectRegion = z.infer<typeof objectRegionSchema>;

// Suggestions translate common storyboard nouns for CLIPSeg. Custom phrases are passed through.
const vocabulary = [
  ["人物", "person", /人物|人群|一[名个人]|骑手|士兵|伪军|通信员|男人|女人|孩子|女孩|男孩|\b(person|people|rider|man|woman|child)\b/i],
  ["马", "horse", /骑马|匹马|马背|马匹|\bhorse\b/i],
  ["城墙", "castle wall", /城墙|城头|\b(city|castle) wall\b/i],
  ["纸飞机", "paper airplane", /纸飞机|\bpaper (airplane|plane)\b/i],
  ["飞机", "airplane", /(?<!纸)飞机|\baircraft\b/i],
  ["树冠", "tree foliage", /树[冠林木叶]|森林|\b(tree|trees|foliage|forest)\b/i],
  ["云", "clouds", /云|\bclouds?\b/i],
  ["建筑", "buildings", /建筑|楼房|\bbuildings?\b/i],
  ["汽车", "car", /汽车|轿车|\bcars?\b/i],
  ["自行车", "bicycle", /自行车|单车|\b(bike|bicycle)\b/i],
  ["狗", "dog", /狗|小犬|\bdogs?\b/i],
  ["猫", "cat", /猫|\bcats?\b/i],
] as const;

export function suggestObjectTargets(source: string, subject?: string): string[] {
  const suggested = vocabulary.filter(([, , match]) => match.test(source)).map(([label]) => label).slice(0, 8);
  if (suggested.length) return suggested;
  const phrase = subject?.trim();
  return [phrase && phrase.length <= 64 ? phrase : "前景主体"];
}
export function objectPrompt(label: string) {
  if (label === "前景主体") return "main foreground object";
  return vocabulary.find(([name]) => name === label)?.[1] ?? label;
}
export function regionPosition([left, top, right, bottom]: z.infer<typeof regionBoxSchema>) {
  const x = (left + right) / 2, y = (top + bottom) / 2;
  const horizontal = right - left > .65 ? "横跨画面" : x < .35 ? "左侧" : x > .65 ? "右侧" : "中部";
  const vertical = bottom - top > .65 ? "纵跨画面" : y < .35 ? "上方" : y > .65 ? "下方" : "中段";
  return horizontal + "、" + vertical;
}
