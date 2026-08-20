export const PUBLISHING_ALBUM_FONT_BUDGET_BYTES = 60 * 1024 * 1024;
export const PUBLISHING_ALBUM_FONT_SOURCE_COMMIT =
  "3b1480ea4b6e15fed70a42f4cb29216476a044ed";

export type PublishingAlbumFontRole = "body" | "title" | "path";

export type PublishingAlbumFontManifestEntry = {
  fontId: string;
  nameZh: string;
  nameEn: string;
  family: string;
  installed: boolean;
  weights: string;
  filePath: string | null;
  licensePath: string | null;
  sourcePath: string | null;
  sourceUrl: string;
  sourceCommit: string;
  sha256: string | null;
  sizeBytes: number | null;
  coverage: readonly string[];
  tags: readonly string[];
  roles: Readonly<Record<PublishingAlbumFontRole, number>>;
};

const root = "client/src/assets/fonts/publishing-album";
const googleRaw = `https://raw.githubusercontent.com/google/fonts/${PUBLISHING_ALBUM_FONT_SOURCE_COMMIT}/ofl`;

export const PUBLISHING_ALBUM_FONTS: readonly PublishingAlbumFontManifestEntry[] = [
  {
    fontId: "noto-sans-sc", nameZh: "思源黑体（简体）", nameEn: "Noto Sans SC",
    family: "Publishing Album Noto Sans SC", installed: true, weights: "100 900",
    filePath: `${root}/noto-sans-sc/NotoSansSC[wght].ttf`,
    licensePath: `${root}/noto-sans-sc/OFL.txt`, sourcePath: `${root}/noto-sans-sc/SOURCE.json`,
    sourceUrl: `${googleRaw}/notosanssc/NotoSansSC%5Bwght%5D.ttf`,
    sourceCommit: PUBLISHING_ALBUM_FONT_SOURCE_COMMIT,
    sha256: "a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da",
    sizeBytes: 17_772_300,
    coverage: ["simplified-chinese", "punctuation", "latin", "digits"],
    tags: ["modern", "minimal", "geometric", "high-contrast", "technology", "dense", "neutral"],
    roles: { body: 10, title: 7, path: 5 },
  },
  {
    fontId: "noto-serif-sc", nameZh: "思源宋体（简体）", nameEn: "Noto Serif SC",
    family: "Publishing Album Noto Serif SC", installed: true, weights: "200 900",
    filePath: `${root}/noto-serif-sc/NotoSerifSC[wght].ttf`,
    licensePath: `${root}/noto-serif-sc/OFL.txt`, sourcePath: `${root}/noto-serif-sc/SOURCE.json`,
    sourceUrl: `${googleRaw}/notoserifsc/NotoSerifSC%5Bwght%5D.ttf`,
    sourceCommit: PUBLISHING_ALBUM_FONT_SOURCE_COMMIT,
    sha256: "050080d9255a86808f2945bffac582b31ef32bc36411ce29563b4961670c66f9",
    sizeBytes: 25_125_512,
    coverage: ["simplified-chinese", "punctuation", "latin", "digits"],
    tags: ["literary", "editorial", "traditional", "quiet", "paper", "painting", "long-form"],
    roles: { body: 10, title: 8, path: 5 },
  },
  {
    fontId: "zcool-xiaowei", nameZh: "站酷小薇体", nameEn: "ZCOOL XiaoWei",
    family: "Publishing Album ZCOOL XiaoWei", installed: true, weights: "400",
    filePath: `${root}/zcool-xiaowei/ZCOOLXiaoWei-Regular.ttf`,
    licensePath: `${root}/zcool-xiaowei/OFL.txt`, sourcePath: `${root}/zcool-xiaowei/SOURCE.json`,
    sourceUrl: `${googleRaw}/zcoolxiaowei/ZCOOLXiaoWei-Regular.ttf`,
    sourceCommit: PUBLISHING_ALBUM_FONT_SOURCE_COMMIT,
    sha256: "a42b620140f493db42f741351dfbf343c0936d58588ee8004b8b2a218d997ff1",
    sizeBytes: 6_313_808,
    coverage: ["simplified-chinese", "punctuation", "latin", "digits"],
    tags: ["retro", "editorial", "republic-era", "serif", "poster"],
    roles: { body: 7, title: 10, path: 7 },
  },
  {
    fontId: "ma-shan-zheng", nameZh: "马善政毛笔楷书", nameEn: "Ma Shan Zheng",
    family: "Publishing Album Ma Shan Zheng", installed: true, weights: "400",
    filePath: `${root}/ma-shan-zheng/MaShanZheng-Regular.ttf`,
    licensePath: `${root}/ma-shan-zheng/OFL.txt`, sourcePath: `${root}/ma-shan-zheng/SOURCE.json`,
    sourceUrl: `${googleRaw}/mashanzheng/MaShanZheng-Regular.ttf`,
    sourceCommit: PUBLISHING_ALBUM_FONT_SOURCE_COMMIT,
    sha256: "6d2546bb189c732a8ca29af9e22457b152387d158aa459e4ac2ce1e51788b7fb",
    sizeBytes: 5_857_936,
    coverage: ["simplified-chinese", "punctuation", "latin", "digits"],
    tags: ["ink", "brush", "dramatic", "festive", "emotional", "short-form"],
    roles: { body: 3, title: 10, path: 9 },
  },
  {
    fontId: "zhi-mang-xing", nameZh: "志莽行书", nameEn: "Zhi Mang Xing",
    family: "Publishing Album Zhi Mang Xing", installed: true, weights: "400",
    filePath: `${root}/zhi-mang-xing/ZhiMangXing-Regular.ttf`,
    licensePath: `${root}/zhi-mang-xing/OFL.txt`, sourcePath: `${root}/zhi-mang-xing/SOURCE.json`,
    sourceUrl: `${googleRaw}/zhimangxing/ZhiMangXing-Regular.ttf`,
    sourceCommit: PUBLISHING_ALBUM_FONT_SOURCE_COMMIT,
    sha256: "644e0cae9b40f0b10ab729a01bd32032e3973bac22be3dccae01bf6ae7fde969",
    sizeBytes: 4_063_532,
    coverage: ["simplified-chinese", "punctuation", "latin", "digits"],
    tags: ["handwritten", "travel", "youthful", "free", "ink", "short-form"],
    roles: { body: 2, title: 8, path: 10 },
  },
  {
    fontId: "lxgw-wenkai", nameZh: "霞鹜文楷", nameEn: "LXGW WenKai",
    family: "LXGW WenKai", installed: false, weights: "300 700",
    filePath: null, licensePath: null, sourcePath: null,
    sourceUrl: "https://github.com/lxgw/LxgwWenKai",
    sourceCommit: "research-pool-only",
    sha256: null, sizeBytes: null,
    coverage: ["research-only"],
    tags: ["humanist", "literary", "handwritten", "long-form"],
    roles: { body: 9, title: 7, path: 6 },
  },
] as const;

export function installedPublishingAlbumFonts(): PublishingAlbumFontManifestEntry[] {
  return PUBLISHING_ALBUM_FONTS.filter(font => font.installed);
}

export function publishingAlbumFontById(fontId: string): PublishingAlbumFontManifestEntry | null {
  return PUBLISHING_ALBUM_FONTS.find(font => font.fontId === fontId) ?? null;
}
