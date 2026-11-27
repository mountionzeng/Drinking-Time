import { bookReferenceIntent } from "./bookRenderReference";

type VisualShot = {
  id: string;
  title: string;
  scene?: string;
  picture: string;
  video: string;
  images: string[];
};

export type BookShotLink = {
  sourceId: string;
  sourceNumber: number;
  sourceTitle: string;
  reason: "同一场景" | "同一画面素材" | "同一分场";
  sourcePicture: string;
};

const changedScene = /换场|(?:另换|改到|改成|换到|换成|另)(?:另?一[个条座间处]|别的|新的)?(?:场景|地点|地方|街道|步道|房间)|(?:不(?:要|用|再|必)?|别|取消)\s*(?:参考|沿用|承接|延续|回到|切回|保持)|(?:不在|不是)同一/u;
const previousView = /(?:延续|承接|接续|接着|保持|仍是|还是)(?:在|用)?(?:上|前)一镜(?:头)?(?:的)?(?:场景|机位|视角|空间|环境|位置|画面|人物)|(?:与|和)(?:上|前)一镜(?:头)?(?:的)?(?:场景|机位|视角|环境)(?:一致|相同)/u;
const locationCue = /(?:同一|原先那|刚才那|还是那|(?:回到|切回)(?:之前|此前|刚才|先前)?(?:的|那))(?:条|座|间|片|处|个|段|扇|棵|辆|张|位|名|面)?([\p{Script=Han}]{1,16})/u;

/** Read the last applicable visual direction; a correction supersedes earlier directions. */
function continuitySource(shot: VisualShot, prior: VisualShot[], preceding: number) {
  const clauses = (shot.picture + "。" + shot.video).split(/[，,。！!？?；;\n]/u);
  for (const clause of clauses.reverse()) {
    if (/(?:旁白|对白|字幕|音乐|钢琴声|配乐|音效|声音)/u.test(clause)) continue;
    if (changedScene.test(clause)) return;
    const hint = bookReferenceIntent(clause);
    if (hint && hint.use !== "continuity") return;
    if (typeof hint?.source === "number") return prior[hint.source - preceding - 1];
    if (hint?.source === "previous" || previousView.test(clause)) {
      const previous = prior.at(-1);
      if (previous?.scene === shot.scene) return previous;
    }
    const noun = locationCue.exec(clause)?.[1]
      .split(/(?:的|里|上|旁|内|中|前景|远处|近处|尽头|仍|依然|出现|已经|走进|站着)/u)[0];
    if (noun && noun.length >= 2) {
      const match = prior.findLast(p => p.scene === shot.scene && (p.picture + " " + p.title).includes(noun));
      if (match) return match;
    }
  }
}

/** Derive links from authored visual directions or an actual shared image in this chapter. */
export function bookShotLinks(shots: VisualShot[], preceding = 0) {
  const links = new Map<string, BookShotLink>();
  const prior: VisualShot[] = [];
  const numbers = new Map<string, number>();
  for (const shot of shots) {
    const scene = continuitySource(shot, prior, preceding);
    const sharedImage = !scene && shot.images.length ? prior.findLast(p =>
      p.images.some(url => shot.images.includes(url))) : undefined;
    const source = scene ?? sharedImage ?? (shot.scene ? prior.findLast(p => p.scene === shot.scene) : undefined);
    if (source) {
      links.set(shot.id, {
        sourceId: source.id,
        sourceNumber: numbers.get(source.id)!,
        sourceTitle: source.title,
        reason: scene ? "同一场景" : sharedImage ? "同一画面素材" : "同一分场",
        sourcePicture: source.picture,
      });
    }
    numbers.set(shot.id, preceding + prior.length + 1);
    prior.push(shot);
  }
  return links;
}

export function linkedScenePrompt(current: string, link?: BookShotLink) {
  if (!current || link?.reason !== "同一场景" || !link.sourcePicture || link.sourcePicture === current) return current;
  return `延续此前的环境（${link.sourcePicture}）。\n这一帧按以下构图呈现。\n${current}`;
}
