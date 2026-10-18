# Landing page fonts

- Logo: existing `client/src/assets/fonts/honglei-zhuoshu-brand.ttf`, registered globally as Honglei Zhuoshu.
- Title: `title-sung.woff`, subset of `/Users/yuandai/Library/Fonts/TW-Sung -可商用.ttf` (TW-Sung / 全字庫正宋體), regular weight.
- Reading: `reading-sans.woff`, subset of `client/src/assets/fonts/publishing-album/noto-sans-sc/NotoSansSC[wght].ttf`, variable weight. License: `reading-sans-OFL.txt`.

Subsets include characters in `client/src/pages/ShiguangLandingPage.tsx`. Regenerate when copy changes; unbundled characters fall back to the declared system fonts. Full title source remains in the local font library; review its redistribution terms before public release.

From the repository root:

```sh
python3 -m fontTools.subset '/Users/yuandai/Library/Fonts/TW-Sung -可商用.ttf' --text-file=client/src/pages/ShiguangLandingPage.tsx --flavor=woff --output-file=client/public/shiguang/landing/title-sung.woff
python3 -m fontTools.subset 'client/src/assets/fonts/publishing-album/noto-sans-sc/NotoSansSC[wght].ttf' --text-file=client/src/pages/ShiguangLandingPage.tsx --flavor=woff --output-file=client/public/shiguang/landing/reading-sans.woff
```
