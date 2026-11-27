/** A photo lookup is a read-only chat action. Media creation and edit requests keep their existing routes. */
export function asksForStoryPictures(text: string) {
  return (
    text.length <= 1000 &&
    /(?:找|搜|查|翻|整理|列出|看看|看一下|有哪些|还有哪些)/u.test(text) &&
    /(?:图片|照片|插画|素材图|配图|参考图|旧图|书页|扫描页)/u.test(text) &&
    !/(?:不要|不用|无需|别再?|不需要).{0,8}(?:找|搜|整理)|(?:都不要|都不需要)|(?:生成|渲染)(?!过|的)|画一|画张|出图|制作|重新编辑|写.{0,4}(?:分镜|剧本)/u.test(
      text
    )
  );
}
export function otherStoryPictures(text: string) {
  return /(?:所有|别的|其他|其它|不同|别本|跨|以前的|之前的|其他的|其它的)(?:的)?(?:故事|作品|项目)|我的图库|全账号/u.test(
    text
  );
}
export function pictureSearchTerms(text: string) {
  const clean = text
    .toLowerCase()
    .replace(
      /(?:帮我|请你|能不能|有没有|找一下|找一找|找找|搜索|搜一下|查找|找出|整理|列出|看看|看一下|有哪些|一下|我想|可以|图片|照片|素材图|配图|参考图|素材|插画|旧图|之前|以前|先前|过去|所有|其他|其它|别的|这本|这个|当前|我的图库|故事|作品|项目|里面|提供|上传|用过|点过|点开过|采用过|找|搜|我|的|在|过|里|给|请|了|那些|已经|曾经|一下)/gu,
      " "
    );
  const tokens = new Set<string>();
  for (const match of clean.matchAll(/[\p{Script=Han}]+|[a-z0-9]+/gu)) {
    const word = match[0];
    if (word.length < 2) continue;
    tokens.add(word);
    if (/\p{Script=Han}/u.test(word))
      for (let i = 0; i + 1 < word.length; i++)
        tokens.add(word.slice(i, i + 2));
  }
  return [...tokens];
}
