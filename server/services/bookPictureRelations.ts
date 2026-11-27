import type { ImageAsset } from "../../shared/imageAsset";
import { readBookShotChapter, shotDirections, shotMediaDirections } from "../../shared/bookShotDocument";
import { needsProviderImageCopy } from "../../shared/providerImageUrl";

type Shot = ReturnType<typeof readBookShotChapter>["shots"][number];

// These are visual families, not evidence that two buildings or two people are identical.
const surfaces = [
  { words: /城墙|城楼|城门|城垛|城角|墙头|炮楼/u, label: "城墙的砖石和建筑外观" },
  { words: /树荫|树影|林荫|公园步道/u, label: "树木和步道的环境" },
  { words: /月台|站台|候车厅/u, label: "车站的建筑和材质" },
];
const segmenter = new Intl.Segmenter("zh", { granularity: "word" });
const generic = /^(?:画面|出现|清楚|看到|一张|一个|一面|只有|人物|个人|只有|前景|背景|远处|近处|中间|左边|右边|画幅|光线|镜头|照片|黑白|位置|旁边|还是|那里|上方|下方|已经|一截|只剩|几乎|看见|参考|同一|全貌)$/u;
function visualNouns(text: string) {
  return [...segmenter.segment(text)].filter(s => s.isWordLike && s.segment.length >= 2 && !generic.test(s.segment)).map(s => s.segment);
}

function relation(target: Shot, source: Shot, picture: string, other: string, imageUrl: string, names: string[]) {
  if (source.moduleId === target.moduleId) return { score: 5, use: "本镜已用图的主体和构图" };
  if (target.link?.sourceId === source.moduleId && target.link.reason === "同一场景")
    return { score: 4, use: "同一场景的空间和固定物体" };
  if (target.images.some(i => i.url === imageUrl)) return { score: 4, use: "同一张原图里本镜点名的主体" };
  const people = names.filter(name => picture.includes(name) && other.includes(name));
  if (people.length) return { score: 3, use: people.join("、") + "可辨认的相貌和装束" };
  for (const family of surfaces) {
    if (family.words.test(picture) && family.words.test(other)) return { score: 2, use: family.label };
  }
  const shared = visualNouns(other).filter(word => picture.includes(word));
  if (shared.length >= 2 || shared.some(word => word.length >= 3)) {
    const features = [...new Set(shared)].slice(0, 3);
    return { score: 1, use: "两镜都写到的" + features.join("、") + "的外观" };
  }
}

/** Only recommend manuscript images or the author's adopted take on a linked shot. */
export function relatedBookPictures(shots: Shot[], ownerId: string | undefined, assets: ImageAsset[],
  linkedShots: (id: string) => Record<string, unknown>[], filmImageId?: number | null, names: string[] = []) {
  const target = shots.find(s => s.moduleId === ownerId);
  if (!target) return [];
  const usable = assets.filter(a => a.id !== filmImageId && a.availability !== "missing" && a.status !== "rejected" &&
    !/书页扫描|扫描页|文献扫描|扫描书页/u.test(a.prompt ?? ""));
  const byUrl = new Map(usable.map(a => [a.imageUrl, a]));
  const visual = (shot: Shot) => shotMediaDirections(shotDirections(shot.notes), shot.title).picture;
  const picture = visual(target);
  const matches = shots.flatMap(source => {
    const page = source.images.flatMap(i => byUrl.get(i.url) ?? []);
    const ids = linkedShots(source.moduleId).map(s => s.stableShotId);
    const images = page.length ? page : usable.filter(a => a.isPrimary && a.selectionSource === "explicit" && a.shotIdentity && ids.includes(a.shotIdentity));
    const other = visual(source);
    return images.flatMap(image => {
      const match = relation(target, source, picture, other, image.imageUrl, names);
      return match ? [{ ...match, kind: "content" as const, imageId: image.id, imageUrl: image.imageUrl, sourceTitle: source.title,
        needsCopy: needsProviderImageCopy(image.imageUrl) }] : [];
    });
  }).sort((a,b) => b.score - a.score);
  const unique = new Set<number>();
  return matches.filter(m => { if (unique.has(m.imageId)) return false; unique.add(m.imageId); return true; }).slice(0, 3)
    .map(({ score, ...item }) => item);
}
