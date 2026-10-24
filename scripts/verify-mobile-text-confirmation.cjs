// Run against the main repository dev server on port 3000. No real API calls.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const fixtureUrl =
  "/@fs/" + path.resolve(__dirname, "fixtures/mobile-text-confirmation.tsx");
const outputDir =
  process.env.MOBILE_QA_OUTPUT_DIR || require("node:os").tmpdir();
let activeBrowser;
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  activeBrowser = browser;
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/__qa-mobile**", route =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"/><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module" src="/@vite/client"></script></head><body><div id="root"></div><script type="module" src="${fixtureUrl}"></script></body></html>`,
    })
  );
  await page.route("**/api/trpc/**", route => {
    errors.push("BLOCKED REAL API " + route.request().url());
    return route.abort();
  });
  await page.goto("http://localhost:3000/__qa-mobile");
  await page
    .getByRole("button", { name: "查看并确认文字", exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: "上传图片", exact: true }).count(),
    0
  );
  assert.equal(
    await page
      .getByRole("button", { name: "把排版分享回给作者", exact: true })
      .isVisible(),
    false
  );
  await page
    .locator("summary")
    .filter({ hasText: /^协作与分享$/ })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "把排版分享回给作者", exact: true })
      .isVisible(),
    true
  );
  await page
    .locator("summary")
    .filter({ hasText: /^协作与分享$/ })
    .click();
  await page.waitForTimeout(400);
  await page.screenshot({
    path: path.join(outputDir, "mobile-confirm-gallery.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "添加图片", exact: true }).click();
  await page.getByRole("button", { name: "根据文字生成", exact: true }).click();
  await page.getByRole("dialog", { name: "确认配图用的文字" }).waitFor();
  assert.equal(
    await page.locator("article").innerText(),
    "雨中的旧伞\n\n爷爷把旧伞放在窗边。窗外的雨下了一整夜，屋里留着淡淡的茶香。\n\n第二天清早，他修好了松动的伞骨，说这把伞还可以陪我们走很远。"
  );
  assert.equal(
    await page.evaluate(
      () => __qa.calls.filter(c => c.type === "mutation").length
    ),
    0
  );
  await page.waitForTimeout(400);
  await page.screenshot({
    path: path.join(outputDir, "mobile-confirm-preview.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "确认这版，继续配图", exact: true })
    .click();
  await page.getByRole("dialog", { name: "基于当前文案生成图片" }).waitFor();
  let calls = await page.evaluate(() =>
    __qa.calls.filter(c => c.type === "mutation")
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "textDrafts.adopt");
  assert.equal(calls[0].input.expectedRevision, 7);
  assert.equal(calls[0].input.expectedPublishingRevision, 0);
  assert.equal(
    await page.getByRole("button", { name: /确认生成 4 张/ }).isEnabled(),
    true
  );
  await page.waitForTimeout(400);
  await page.screenshot({
    path: path.join(outputDir, "mobile-confirm-cost.png"),
    fullPage: true,
  });
  await page.goto("http://localhost:3000/__qa-mobile?conflict=1");
  await page
    .getByRole("button", { name: "查看并确认文字", exact: true })
    .click();
  await page.evaluate(() => __qa.concurrentChange());
  await page
    .getByRole("button", { name: "确认这版，继续配图", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("alert")
    .filter({ hasText: "发布稿已变化" })
    .waitFor();
  assert.equal(
    await page.getByRole("dialog", { name: "基于当前文案生成图片" }).count(),
    0
  );
  await page.getByRole("button", { name: "返回文字修改", exact: true }).click();
  assert.equal(await page.evaluate(() => __qa.back), true);
  await page.goto("http://localhost:3000/__qa-mobile?mode=text");
  await page
    .getByRole("button", { name: "确认文字并配图", exact: true })
    .click();
  await page.getByRole("dialog", { name: "确认这一版文字" }).waitFor();
  await page
    .getByRole("textbox", { name: "标题", exact: true })
    .fill("修好的旧伞");
  await page
    .getByRole("button", { name: "确认这版，继续配图", exact: true })
    .click();
  await page.getByRole("button", { name: "添加图片", exact: true }).waitFor();
  assert.equal(
    await page.evaluate(
      () => __qa.publishing().drafts.xiaohongshu.content.title
    ),
    "修好的旧伞"
  );
  assert.equal(
    await page
      .getByRole("button", { name: "查看并确认文字", exact: true })
      .count(),
    0
  );
  await page.setViewportSize({ width: 320, height: 740 });
  await page.waitForTimeout(400);
  await page.screenshot({
    path: path.join(outputDir, "mobile-confirm-320.png"),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    ),
    true
  );
  assert.equal(
    await page.evaluate(
      () => __qa.calls.filter(c => c.path.includes("generate")).length
    ),
    0
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://localhost:3000/__qa-mobile?mode=writing");
  await page.getByRole("button", { name: /找小忆/ }).click();
  const article = page.getByRole("article", { name: "当前文章" });
  await article.waitFor();
  const input = page.getByRole("textbox", { name: "给聊聊发送消息" });
  await input.fill("把结尾写得轻一点，先别发送");
  assert.equal(
    await page
      .getByRole("button", { name: "导入本地文件", exact: true })
      .isVisible(),
    false
  );
  assert.equal(
    await page
      .getByRole("button", { name: "生成新版本", exact: true })
      .isVisible(),
    false
  );
  await page.waitForTimeout(700);
  const a = await article.boundingBox();
  const box = await input.boundingBox();
  assert(
    a.height > 300 && a.y + a.height < box.y,
    JSON.stringify({ article: a, input: box })
  );
  assert.equal(
    await article.evaluate(el => el.scrollHeight > el.clientHeight),
    true
  );
  await page.waitForTimeout(700);
  await page.screenshot({
    path: path.join(outputDir, "mobile-writing-split.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "导入本地文件", exact: true })
      .isVisible(),
    true
  );
  await page.getByRole("button", { name: "更多操作", exact: true }).click();
  await page.getByRole("button", { name: "收起", exact: true }).click();
  await page.evaluate(() =>
    __qa.updateText("这是返回文章后修改的最新正文，聊天输入应继续保留。")
  );
  await page.getByRole("button", { name: /找小忆/ }).click();
  await page
    .getByText("这是返回文章后修改的最新正文，聊天输入应继续保留。", {
      exact: true,
    })
    .waitFor();
  assert.equal(await input.inputValue(), "把结尾写得轻一点，先别发送");
  await page.setViewportSize({ width: 320, height: 520 });
  await page.waitForTimeout(400);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    ),
    true
  );
  const smallArticle = await article.boundingBox();
  const smallInput = await input.boundingBox();
  assert(
    smallArticle.height > 100 &&
      smallArticle.y + smallArticle.height <= smallInput.y &&
      smallInput.y + smallInput.height <= 520
  );
  await page.screenshot({
    path: path.join(outputDir, "mobile-writing-compact.png"),
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => __qa.calls.filter(c => c.type === "mutation").length
    ),
    0
  );
  console.log(
    "PASS: 390/320px gallery, review, captured revisions, explicit adoption, conflict, edited text -> images; no paid generation or real API"
  );
  console.log(
    "PASS: article above chat, collapsed tools, retained draft and refreshed same-text context, compact viewport; no mutations"
  );
  assert.deepEqual(errors, []);
  await browser.close();
})().catch(async e => {
  console.error(e);
  await activeBrowser?.close();
  process.exitCode = 1;
});
