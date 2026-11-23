// Open a populated story in a dedicated agent-browser session on the local editor.
// Usage: node scripts/verify-storyboard-gestures.cjs <session>
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");

const session = process.argv[2];
assert.ok(session, "Provide the dedicated browser session name");
const run = (...args) => execFileSync("agent-browser", ["--session", session, ...args], { encoding: "utf8" });
const evaluate = (fn, input = null) => JSON.parse(run("--json", "eval", `(${fn})(${JSON.stringify(input)})`)).data.result;
const click = label => run("find", "role", "button", "click", "--name", label, "--exact");
const url = new URL(run("get", "url").trim());
assert.ok(["127.0.0.1", "localhost"].includes(url.hostname) && url.port === "3000" && url.pathname === "/editing",
  "Use the existing local editor on port 3000");

// agent-browser's mouse wheel command sends its input at (0, 0). Use the
// same browser session's DevTools connection for absolute wheel coordinates.
async function wheelInput() {
  const endpoint = new URL(run("get", "cdp-url").trim());
  assert.equal(endpoint.hostname, "127.0.0.1");
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const receive = ({ data }) => {
      const reply = JSON.parse(data);
      if (reply.id !== id) return;
      socket.removeEventListener("message", receive);
      if (reply.error) reject(new Error(reply.error.message));
      else resolve(reply.result);
    };
    socket.addEventListener("message", receive);
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  try {
    const { targetInfos } = await send("Target.getTargets");
    const tabs = targetInfos.filter(target => target.type === "page" && target.url === url.href);
    assert.equal(tabs.length, 1, "Use one editor tab in the dedicated test session");
    const { sessionId } = await send("Target.attachToTarget", { targetId: tabs[0].targetId, flatten: true });
    return {
      close: () => socket.close(),
      wheel: ({ x, y }, deltaY, deltaX = 0, modifiers = 0) => {
        assert.ok(x > 0 && y > 0);
        return send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX, deltaY, modifiers }, sessionId);
      },
    };
  } catch (error) {
    socket.close();
    throw error;
  }
}

const inspect = async ({ gesture, manuscript }) => {
  const clipArea = document.querySelector(manuscript
    ? '[aria-label="分镜稿剪辑栏"]'
    : '[data-testid="storyboard-scroll-viewport"]');
  const ruler = clipArea?.querySelector('[aria-label="时间标尺"], [aria-label="Time ruler"]');
  if (!ruler?.getBoundingClientRect().width) return null;
  const bounds = clipArea.getBoundingClientRect();
  const header = ruler.previousElementSibling.getBoundingClientRect().width;
  const anchor = Math.round((bounds.width - header) * 0.45);
  const x = Math.round(bounds.left + header + anchor);
  const y = Math.round(ruler.getBoundingClientRect().top + 10);
  const surface = document.elementFromPoint(x, y);
  if ((gesture === "safari" || gesture === "watch") && !clipArea.contains(surface)) {
    throw new Error("Time ruler is covered or off screen");
  }
  const editor = gesture === "after-native" ? window.storyboardTestFocus : document.activeElement;
  const verticalScroller = manuscript ? clipArea.parentElement : clipArea;
  const state = () => ({
    width: ruler.getBoundingClientRect().width,
    left: clipArea.scrollLeft,
    top: verticalScroller.scrollTop,
    playhead: clipArea.querySelector('[role="slider"][aria-valuenow]')?.getAttribute("aria-valuenow"),
    selection: [...clipArea.querySelectorAll('[aria-selected="true"], [data-batch-selected="true"]')]
      .map(el => el.getAttribute("aria-label") ?? el.getAttribute("data-testid")),
    focused: document.activeElement === editor,
    draft: editor?.isContentEditable ? editor.textContent : editor?.value,
  });
  const before = state();
  let consumed;
  if (gesture === "safari") {
    consumed = ["gesturestart", "gesturechange", "gestureend"].every((type, i) => {
      const event = Object.assign(new Event(type, { bubbles: true, cancelable: true }),
        { scale: i === 0 ? 1 : 1.25, clientX: x, clientY: y });
      surface.dispatchEvent(event);
      return event.defaultPrevented;
    });
  } else if (gesture === "watch") {
    window.storyboardTestFocus = editor;
    window.storyboardTestWheel = null;
    window.addEventListener("wheel", event => {
      window.storyboardTestWheel = {
        trusted: event.isTrusted,
        ctrl: event.ctrlKey,
        consumed: event.defaultPrevented,
        inside: clipArea.contains(event.target),
      };
    }, { once: true, passive: true });
  }
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  if (gesture === "after-native") delete window.storyboardTestFocus;
  return { before, after: state(), consumed, anchor, x, y };
};

async function checkZoom(input, manuscript, gesture, ratio) {
  let result;
  if (gesture === "safari") {
    result = evaluate(inspect, { manuscript, gesture });
  } else {
    const start = evaluate(inspect, { manuscript, gesture: "watch" });
    await input.wheel(start, gesture === "in" ? -60 : 60, 0, 2);
    const event = evaluate(() => window.storyboardTestWheel);
    assert.deepEqual(event, { trusted: true, ctrl: true, consumed: true, inside: true },
      `${manuscript ? "分镜稿" : "完整"} did not handle ${gesture}`);
    const finish = evaluate(inspect, { manuscript, gesture: "after-native" });
    result = { ...start, after: finish.after, consumed: event.consumed };
  }
  assert.ok(result?.consumed, `${manuscript ? "分镜稿" : "完整"} did not handle ${gesture}`);
  const { before, after, anchor } = result;
  assert.ok(Math.abs(after.width / before.width - ratio) < 0.004, "One gesture must apply one scale change");
  assert.ok(Math.abs((after.left + anchor) - (before.left + anchor) * after.width / before.width) < 2,
    "Time beneath the pointer moved");
  assert.equal(after.playhead, before.playhead);
  assert.deepEqual(after.selection, before.selection);
  assert.equal(after.focused, true);
  assert.equal(after.draft, before.draft);
  assert.equal(after.top, before.top);
  console.log(`${manuscript ? "分镜稿" : "完整"} ${gesture}: ${before.width.toFixed(1)} → ${after.width.toFixed(1)} px`);
  return result;
}

async function checkScroll(input, manuscript) {
  const read = () => evaluate(inspect, { manuscript }).after;
  const start = evaluate(inspect, { manuscript });
  const before = start.after;
  await input.wheel(start, 4, 35);
  const right = read();
  assert.ok(right.left > before.left, "Horizontal input must pan the time viewport");
  assert.equal(right.top, before.top);
  await input.wheel(start, 0, -35);
  const left = read();
  assert.equal(left.left, before.left);
  await input.wheel(start, 60);
  run("wait", "150");
  const below = read();
  assert.equal(below.left, left.left);
  assert.ok(below.top > left.top, "Ordinary vertical scrolling must use the existing vertical container");
  await input.wheel(start, -60);
  run("wait", "150");
  console.log(`${manuscript ? "分镜稿" : "完整"} scroll: x ${before.left} → ${right.left} → ${left.left}, y ${left.top} → ${below.top}`);
}

async function main() {
  const input = await wheelInput();
  try {
    click("分镜稿");
    run("focus", '[data-testid="inline-chat-composer"]');
    await checkZoom(input, true, "in", Math.exp(0.3));
    await checkZoom(input, true, "out", Math.exp(-0.3));
    await checkZoom(input, true, "safari", 1.25);
    await checkScroll(input, true);
    click("剪辑与预览");
    click("完整");
    run("focus", '[data-testid="inline-chat-composer"]');
    await checkZoom(input, false, "in", Math.exp(0.3));
    await checkZoom(input, false, "out", Math.exp(-0.3));
    await checkZoom(input, false, "safari", 1.25);
    await checkScroll(input, false);
    click("简读");
    assert.equal(evaluate(inspect, { manuscript: false }), null, "Simple reading has no time ruler");
    click("完整");
    await checkZoom(input, false, "in", Math.exp(0.3));
    click("分镜稿");
    await checkZoom(input, true, "in", Math.exp(0.3));
  } finally {
    input.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
