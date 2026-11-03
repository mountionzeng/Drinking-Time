import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { SharedBookContent } from "./SharedBookContent";
vi.stubGlobal("React", React);

it("renders the picture between formatted text blocks without leaking markup or interpreting HTML", () => {
  const html = renderToStaticMarkup(<SharedBookContent reading={{blocks:[
    {kind:"text",text:"**标题**"},
    {kind:"image",image:0,crop:{x:0.25,y:0,width:0.5,height:1}},
    {kind:"text",text:"后文 $x^2$ <script>bad()</script>"},
  ]}} images={[{dataUrl:"data:image/png;base64,AAAA",width:200,height:100}]} />);
  expect(html.indexOf("标题")).toBeLessThan(html.indexOf("<image"));
  expect(html.indexOf("<image")).toBeLessThan(html.indexOf("后文"));
  expect(html).toContain('viewBox="50 0 100 100"');
  expect(html).toContain("<strong>");
  expect(html).toContain("katex");
  expect(html).not.toContain("**");
  expect(html).not.toContain("<script>");
});
