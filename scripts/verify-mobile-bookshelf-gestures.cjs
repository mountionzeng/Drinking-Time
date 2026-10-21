// 在主仓3000执行；仅书架接口使用虚构数据并拦截全部写请求。需本机Playwright和Chrome。
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
let activeBrowser;
(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  activeBrowser = browser;
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(90000);
  const mutations = [];
  const space = {
    revision: 1,
    shelfView: "vertical",
    shelves: [],
    people: [],
    relationships: [],
    books: Array.from({ length: 16 }, (_, i) => ({
      id: 10001 + i,
      title: `手势验收故事${i + 1}`,
      view: "vertical",
      coverUrl: null,
      hasText: true,
      updatedAt: 1000,
      fingerprint: "a".repeat(64),
      unread: false,
      isNew: false,
      pending: 0,
      wordCount: 300,
      wordCountLabel: "正文",
      activeEditingMs: null,
      editors: [],
    })),
  };
  await page.route("**/api/trpc/**", async route => {
    const req = route.request();
    const names = new URL(req.url()).pathname.split("/api/trpc/")[1].split(",");
    if (!names.some(n => n.startsWith("memorySpace."))) return route.continue();
    if (req.method() === "POST") {
      const data = req.postDataJSON();
      const results = names.map((name, i) => {
        assert.equal(name, "memorySpace.change");
        const op = (data[i]?.json ?? data.json).operation;
        mutations.push(op);
        if (op.kind === "dragBook") {
          let shelf = space.shelves.find(s => s.id === op.target);
          if (!shelf) {
            shelf = {
              id: op.newShelfId,
              name: op.target === "new" ? "新书架" : "我的故事",
              storyIds:
                op.target === "default"
                  ? space.books
                      .filter(
                        b => !space.shelves.some(s => s.storyIds.includes(b.id))
                      )
                      .map(b => b.id)
                  : [],
            };
            space.shelves.push(shelf);
          }
          space.shelves.forEach(
            s => (s.storyIds = s.storyIds.filter(id => id !== op.storyId))
          );
          shelf.storyIds.splice(
            op.beforeStoryId === null
              ? shelf.storyIds.length
              : shelf.storyIds.indexOf(op.beforeStoryId),
            0,
            op.storyId
          );
          space.revision++;
        }
        return { result: { data: { json: { saved: true } } } };
      });
      return route.fulfill({
        json: new URL(req.url()).searchParams.has("batch")
          ? results
          : results[0],
      });
    }
    const data = names.map(name => {
      assert.equal(name, "memorySpace.list");
      return { result: { data: { json: space } } };
    });
    await route.fulfill({
      json: new URL(req.url()).searchParams.has("batch") ? data : data[0],
    });
  });
  await page.goto("http://127.0.0.1:3000/m", {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  const close = page.getByRole("button", { name: "把信收好，继续聊" });
  await close.waitFor({ timeout: 30000 });
  await close.evaluate(e => e.click());
  await page
    .locator('nav[aria-label="全部内容"]')
    .getByRole("button", { name: "故事", exact: true })
    .click();
  await page.locator(".memory-book").first().waitFor();
  assert.equal(
    await page.getByRole("button", { name: "整理书架", exact: true }).count(),
    0
  );
  const cdp = await context.newCDPSession(page);
  const touch = async (type, x, y) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints:
        type === "touchEnd" || type === "touchCancel" ? [] : [{ x, y }],
    });
  const center = async loc => {
    const r = await loc.boundingBox();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  let p = await center(page.locator(".memory-book").first());
  await touch("touchStart", p.x, p.y);
  await page.waitForTimeout(600);
  await touch("touchEnd");
  await page.getByLabel(/调整手势验收故事1的摆放方式/).waitFor();
  assert.equal(mutations.length, 0);
  await page.keyboard.press("Escape");
  await touch("touchStart", p.x, p.y);
  await page.waitForTimeout(600);
  await touch("touchCancel");
  assert.equal(mutations.length, 0);
  // Normal swipe stays a scroll, not a reorder.
  await touch("touchStart", p.x, p.y);
  await touch("touchMove", p.x + 50, p.y);
  await touch("touchEnd");
  assert.equal(mutations.length, 0);
  p = await center(page.locator(".memory-book").first());
  await touch("touchStart", p.x, p.y);
  await page.waitForTimeout(600);
  const add = await center(page.locator(".memory-add-shelf"));
  await touch("touchMove", add.x, add.y);
  await page.waitForTimeout(100);
  await touch("touchEnd");
  await page.waitForFunction(() =>
    document.querySelector('[data-drop-shelf]:not([data-drop-shelf="default"])')
  );
  assert.equal(mutations.at(-1).target, "new");
  assert.equal(mutations.at(-1).storyId, 10001);
  await page.locator(".memory-controls:not([disabled])").waitFor();
  await page.waitForTimeout(1000);
  // Cross-shelf drop into default creates a persistent manually ordered shelf.
  await page.locator('[data-story-id="10002"]').scrollIntoViewIfNeeded();
  p = await center(page.locator('[data-story-id="10001"] .memory-book'));
  const target = await page.locator('[data-story-id="10002"]').boundingBox();
  await page.screenshot({ path: "/tmp/dt-gesture-before-cross.png" });
  await touch("touchStart", p.x, p.y);
  await page.waitForTimeout(650);
  await touch("touchMove", target.x + 4, target.y + 40);
  await page.waitForTimeout(80);
  await touch("touchEnd");
  await page.waitForTimeout(1200);
  assert.equal(mutations.at(-1).target, "default");
  assert.equal(mutations.at(-1).beforeStoryId, 10002);
  await page.locator(".memory-controls:not([disabled])").waitFor();
  await page.setViewportSize({ width: 320, height: 740 });
  const source = page.locator('[data-story-id="10001"] .memory-book');
  await source.scrollIntoViewIfNeeded();
  p = await center(source);
  const row = source.locator(
    'xpath=ancestor::*[contains(@class,"memory-book-row")]'
  );
  const r = await row.boundingBox();
  const count = mutations.length;
  await touch("touchStart", p.x, p.y);
  await page.waitForTimeout(650);
  await touch("touchMove", r.x + r.width - 4, p.y);
  await page.waitForTimeout(700);
  assert.ok(
    (await row.evaluate(e => e.scrollLeft)) > 0,
    "edge drag should scroll the shelf"
  );
  await touch("touchCancel");
  assert.equal(mutations.length, count);
  await source.scrollIntoViewIfNeeded();
  p = await center(source);
  await touch("touchStart", p.x, p.y);
  await page.waitForTimeout(650);
  await touch("touchMove", 3, 80);
  await touch("touchEnd");
  await page.waitForTimeout(200);
  assert.equal(mutations.length, count, "drop outside shelf must cancel");
  assert.equal(await page.locator(".memory-error").count(), 0);
  await page.screenshot({ path: "/tmp/dt-gesture-mobile.png" });
  console.log(
    "PASS: no organizer, long press opens placement, cancel/swipe do not save, new-shelf drop and cross-shelf position save, edge scrolling, invalid-drop cancel"
  );
  await browser.close();
})().catch(async e => {
  console.error(String(e.message).split("Call log:")[0]);
  await activeBrowser?.close();
  process.exitCode = 1;
});
