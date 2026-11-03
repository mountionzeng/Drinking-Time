import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { WechatEntry } from "./WechatEntry";

it("shows the supplied trial mini-program code and its expiry", () => {
  const html = renderToStaticMarkup(<WechatEntry qrSrc="/shiguang/wechat-trial-qr.png" />);
  expect(html).toContain('src="/shiguang/wechat-trial-qr.png"');
  expect(html).toContain("微信扫一扫，进入体验版");
  expect(html).toContain("11 月 9 日前有效");
});
