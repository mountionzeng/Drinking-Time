// Uses the main checkout's port 3000. All API calls are intercepted with fictional data.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
(async () => {
  const { default: superjson } = await import("superjson");
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(90000);
    const now = new Date();
    const users = Array.from({ length: 28 }, (_, i) => ({ userId: i + 1, email: `demo${i + 1}@example.com`, name: null, role: i === 0 ? "admin" : "user", createdAt: now, lastSignedIn: now, registration: "verified", providers: i === 0 ? ["email", "google"] : ["email"], category: i < 2 ? "own" : "unclassified", lastSeenAt: i < 3 ? now : null, visitCount: i < 3 ? 2 : 0, durationSeconds: 60, giftMinor: 2500000, lifetimeSpentMinor: 500000, reservedMinor: 0, availableMinor: 2000000 }));
    let failSave = false;
    let changes = 0;
    await page.route("**/api/trpc/**", async route => {
      const request = route.request();
      const url = new URL(request.url());
      const names = url.pathname.split("/api/trpc/")[1].split(",");
      const inputs = request.method() === "POST" ? request.postDataJSON() : JSON.parse(url.searchParams.get("input") || "{}");
      if (failSave && names.includes("adminUsers.setCategory")) return route.fulfill({ status: 500, json: { error: { json: { message: "fixture failure", code: -32603, data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } } } } });
      const result = names.map((name, index) => {
        const input = inputs[index]?.json ?? inputs.json;
        let data = null;
        if (name === "auth.me") data = { id: 1, role: "admin", email: "demo1@example.com", openId: "fixture-admin", loginMethod: "email", name: "虚构管理员" };
        if (name === "adminUsers.overview") data = { generatedAt: now, siteHost: "localhost", users, summary: { registered: 28, own: users.filter(u => u.category === "own").length, test: users.filter(u => u.category === "test").length, external: users.filter(u => u.category === "external").length, unclassified: users.filter(u => u.category === "unclassified").length, new7d: 28, active7d: 3, externalActive7d: 0, externalSpentMinor: 0, lifetimeSpentMinor: 14000000, legacy: 1, guests: 0 } };
        if (name === "adminUsers.setCategory") { const user = users.find(u => u.userId === input.userId); assert(user); user.category = input.category; changes++; data = { saved: true }; }
        if (name === "accessAnalytics.overview") data = { generatedAt: now, users: [] };
        if (name === "adminCompute.statement") data = { coverageNote: "虚构账单验收", balance: { availableMinor: 2000000, lifetimeSpentMinor: 500000 }, attentionItems: [], historyItems: [], historyHasMore: false, attentionHasMore: false };
        // No mutation is forwarded to the local server, including the login gift.
        return { result: { data: superjson.serialize(data) } };
      });
      return route.fulfill({ json: url.searchParams.has("batch") ? result : result[0] });
    });
    await page.goto("http://localhost:3000/admin/users", { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.getByRole("heading", { name: "注册与使用" }).waitFor();
    await page.getByRole("button", { name: "下一页", exact: true }).first().click();
    await page.getByText("demo28@example.com", { exact: true }).waitFor();
    await page.getByRole("textbox", { name: "搜索账号" }).fill("demo3@example.com");
    await page.getByRole("combobox", { name: "账号 3 的分类", exact: true }).selectOption("test");
    await page.getByText("分类已保存", { exact: true }).waitFor();
    assert.equal(changes, 1);
    await page.getByRole("button", { name: "查看账号 3 的账单", exact: true }).click();
    await page.getByText("虚构账单验收", { exact: true }).waitFor();
    await page.getByRole("button", { name: "收起账单", exact: true }).click();
    failSave = true;
    await page.getByRole("combobox", { name: "账号 3 的分类", exact: true }).selectOption("external");
    await page.getByRole("alert").filter({ hasText: "分类保存失败" }).waitFor();
    assert.equal(changes, 1);
    assert.equal(await page.getByRole("combobox", { name: "账号 3 的分类", exact: true }).inputValue(), "test");
    failSave = false;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "注册与使用" }).waitFor();
    await page.getByRole("combobox", { name: "筛选账号分类" }).selectOption("test");
    await page.getByText("demo3@example.com", { exact: true }).waitFor();
    assert.equal(await page.getByRole("combobox", { name: "账号 3 的分类", exact: true }).inputValue(), "test");
    await page.getByRole("combobox", { name: "筛选账号分类" }).selectOption("all");
    await page.screenshot({ path: "/tmp/admin-users-desktop.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: "/tmp/admin-users-mobile.png" });
    console.log("PASS: desktop/mobile layout, pagination, search, classification success/failure, refresh, ledger expansion; all API calls intercepted");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
