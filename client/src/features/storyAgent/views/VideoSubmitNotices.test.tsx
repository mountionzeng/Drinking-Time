import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { VideoSubmitNotices } from "./VideoSubmitNotices";

it("shows only failures for visible story shots without offering an unquoted retry", () => {
  const html = renderToStaticMarkup(<VideoSubmitNotices storyId={1}
    shots={[{ stableShotId: "s3", shotNo: 3 }]}
    notices={[{ key: "1:s3", reason: "结果未知" }, { key: "2:s3", reason: "other story private error" }, { key: "1:removed", reason: "removed shot" }]}
    onDismiss={() => {}} />);
  expect(html).toContain('role="alert"');
  expect(html).toContain("03");
  expect(html).toContain("结果未知");
  expect(html).toContain("新生成仍需确认报价");
  expect(html).toContain('aria-label="03 · 关闭渲染提醒"');
  expect(html.match(/<button/g)).toHaveLength(1);
  expect(html).not.toMatch(/other story|removed shot|未扣费/);
});
