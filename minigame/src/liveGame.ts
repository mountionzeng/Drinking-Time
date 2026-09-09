import { createLiveClient, type LiveState } from "./liveClient";
import { classifyRequestFailure } from "./requestFailure";
import { createWorkspaceClient, workspaceError } from "./workspaceClient";
import { renderWorkspace, type WorkspaceView, type Hit } from "./workspaceView";
import {
  createAccountWorkspace,
  EMOTION_ANALYSIS_CONSENT_TEXT,
  type BirthFields,
} from "./accountWorkspace";
import { renderAccount } from "./accountView";
import { formatCny } from "../../shared/computeMoney";
import {
  getTodayNayin,
  BEVERAGE_THEMES,
} from "../../client/src/features/nayin/nayin";
declare const wx: any;
declare const __WECHAT_ENABLED__: boolean;
const API = "https://test.drinkingtime.top/api/minigame";
const canvas = wx.createCanvas(),
  ctx = canvas.getContext("2d");
let width = 0,
  height = 0;
let authState: LiveState = {
  authenticated: false,
  busy: false,
  error: "",
  stories: [],
  document: null,
};
let email = "",
  password = "",
  code = "",
  emailMode: "password" | "otp" = "password",
  editing: "email" | "password" | "code" | "body" | "chat" | "extra" | null =
    null,
  authPending = false,
  lifecycle = 0;
let showEmailLogin = !__WECHAT_ENABLED__;
let linkEmail = '', linkOtp = '';
let extraInput: ((value: string) => void) | null = null;
let activeScope = "";
let hits: Hit[] = [];
let layout = {
  hits: [] as Hit[],
  sheetTop: 0,
  maxBody: 0,
  maxChat: 0,
  maxList: 0,
};
let touch: { x: number; y: number; sheet: boolean; top: number } | null = null;
const images: Record<string, any> = {};
const view: WorkspaceView = {
  screen: "workspace",
  stop: "peek",
  offset: 0,
  chatOffset: 0,
  listOffset: 0,
  safeTop: 64,
  safeBottom: 0,
  keyboardHeight: 0,
  accent: "#927342",
  character: null,
  font: "serif",
  wechat: __WECHAT_ENABLED__,
  dragTop: null,
};
const storage = {
  getItem: (key: string) => wx.getStorageSync(key) || null,
  setItem: (key: string, value: string) => wx.setStorageSync(key, value),
  removeItem: (key: string) => wx.removeStorageSync(key),
};
const auth = createLiveClient(
  (path, method, data, token) =>
    new Promise((resolve, reject) => {
      wx.request({
        url: API + path,
        method,
        data,
        timeout:
          /\/(chat.generate|profile.read|profile.save|letters.reread)$/.test(
            path
          )
            ? 60000
            : 15000,
        header: {
          "content-type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        success: (r: any) => resolve({ status: r.statusCode, data: r.data }),
        fail: (error: unknown) => reject(new Error(classifyRequestFailure(error))),
      });
    }),
  next => {
    const previous = authState.authenticated;
    authState = next;
    if (previous && !next.authenticated) {
      lifecycle++;
      workspace.disconnect();
      accountWorkspace.disconnect();
      activeScope = "";
      extraInput = null;
      editing = null;
      password = "";
      code = '';
      linkEmail = '';
      linkOtp = '';
      showEmailLogin = !__WECHAT_ENABLED__;
      view.screen = "workspace";
      view.stop = "peek";
    }
    if (!previous && next.authenticated) void workspace.connect();
    draw();
  }
);
const accountWorkspace = createAccountWorkspace(
  (operation, input) => auth.workspace(operation, input),
  storage,
  () => draw()
);
const workspace = createWorkspaceClient(
  (operation, input) => auth.workspace(operation, input),
  storage,
  state => {
    if (state.account && activeScope !== state.account.recoveryScope) {
      activeScope = state.account.recoveryScope;
      accountWorkspace.setScope(activeScope);
      void accountWorkspace.balance();
    }
    draw();
  }
);
function size() {
  const info = wx.getSystemInfoSync();
  width = info.windowWidth;
  height = info.windowHeight;
  canvas.width = width * info.pixelRatio;
  canvas.height = height * info.pixelRatio;
  ctx.scale(info.pixelRatio, info.pixelRatio);
  const capsule = wx.getMenuButtonBoundingClientRect?.();
  view.safeTop = Math.max(
    info.safeArea?.top ?? info.statusBarHeight ?? 24,
    capsule?.bottom ?? 64
  );
  view.safeBottom = Math.max(0, height - (info.safeArea?.bottom ?? height));
}
function theme() {
  const today = getTodayNayin();
  view.accent = BEVERAGE_THEMES[today.element].hexDim;
  view.character = images[today.element] ?? null;
}
function draw() {
  if (!width) return;
  theme();
  const balance = accountWorkspace.getState().balance;
  view.balanceText = balance ? formatCny(balance.availableMinor) : "余额未读取";
  if (authState.authenticated) {
    if (["account", "letter", "letterEdit", "linkEmail"].includes(view.screen)) {
      layout = renderAccount(
        ctx,
        width,
        height,
        accountWorkspace.getState(),
        view,
        workspace.getState().account?.email ?? "",
        view.screen as "account" | "letter" | "letterEdit" | 'linkEmail',
        { email: linkEmail, otp: linkOtp, busy: authState.busy || authPending, message: authState.error }
      );
      hits = layout.hits;
      return;
    }
    layout = renderWorkspace(
      ctx,
      width,
      height,
      workspace.getState(),
      view,
      workspace.projection()
    );
    hits = layout.hits;
    return;
  }
  hits = [];
  ctx.fillStyle = "#faf7f1";
  ctx.fillRect(0, 0, width, height);
  const top = view.safeTop + 40;
  const label = (
    text: string,
    x: number,
    y: number,
    size = 16,
    color = "#292521",
    font = "sans-serif"
  ) => {
    ctx.fillStyle = color;
    ctx.font = `${size}px ${font}`;
    ctx.fillText(text, x, y);
  };
  const button = (
    text: string,
    y: number,
    action: string,
    primary = false,
    x = 24,
    w = width - 48
  ) => {
    ctx.fillStyle = primary ? view.accent : "#eee8df";
    ctx.fillRect(x, y, w, 46);
    label(text, x + 14, y + 29, 15, primary ? "#fff" : "#292521");
    hits.push({ x, y, w, h: 46, action });
  };
  if (view.character)
    ctx.drawImage(view.character, width / 2 - 38, top, 76, 84);
  label("碎碎念", width / 2 - 42, top + 116, 28, view.accent, view.font);
  label("把故事接着说下去", width / 2 - 64, top + 149, 15, "#6b635b");
  if (!showEmailLogin && __WECHAT_ENABLED__) {
    button(authPending || authState.busy ? '正在登录…' : '微信登录', top + 184, 'wechat', true);
    button('其他方式：邮箱登录', top + 242, 'showEmailLogin');
    label('先用微信，关联其他账号由你决定。', 24, top + 320, 14, '#6b635b');
    if (authState.error) {
      // Wrap instead of hiding the useful half of the server's error.
      const count = Math.max(1, Math.floor((width - 48) / 13));
      for (let i = 0; i < authState.error.length; i += count)
        label(authState.error.slice(i, i + count), 24, top + 365 + Math.floor(i / count) * 22, 13, '#9b493e');
    }
    return;
  }
  button(
    email ? `邮箱：${email.slice(0, 25)}` : "填写邮箱",
    top + 184,
    "email"
  );
  if (emailMode === "password")
    button(
      password
        ? "密码：" + "•".repeat(Math.min(password.length, 20))
        : "填写密码",
      top + 242,
      "password"
    );
  else {
    button(code ? "验证码：" + code : "填写验证码", top + 242, "code");
    button("获取验证码", top + 242, "requestOtp", false, width - 146, 122);
  }
  button(authState.busy ? "正在登录…" : "邮箱登录", top + 306, "login", true);
  button(
    emailMode === "password" ? "用验证码登录" : "用密码登录",
    top + 366,
    "emailMode"
  );
  if (__WECHAT_ENABLED__) button("返回微信登录", top + 424, "showWechatLogin");
  else label("微信登录待服务端配置完成后开放", 24, top + 449, 13, "#6b635b");
  label("绑定后，邮箱与微信共用同一份故事。", 24, top + 492, 12, "#6b635b");
  if (authState.error)
    label(
      authState.error.slice(0, Math.floor((width - 48) / 13)),
      24,
      Math.min(height - 26, top + 474),
      13,
      "#9b493e"
    );
}
function toast(message: string) {
  wx.showToast({ title: message, icon: "none", duration: 3000 });
}
function keyboard(field: NonNullable<typeof editing>) {
  const state = workspace.getState();
  editing = field;
  if (field === "chat") {
    view.stop = "half";
    view.chatOffset = 0;
  }
  wx.showKeyboard({
    defaultValue:
      field === "email"
        ? email
        : field === "password"
          ? password
          : field === "code"
            ? code
            : field === "body"
              ? (state.document?.body ?? "")
              : state.chatDraft,
    maxLength:
      field === "body"
        ? 20000
        : field === "chat"
          ? 8000
          : field === "email"
            ? 320
            : field === "code"
              ? 6
              : 1024,
    multiple: field === "body" || field === "chat",
    confirmHold: false,
    confirmType: "done",
    fail: () => {
      editing = null;
      toast("键盘打开失败，请重试");
    },
  });
  draw();
}
function changeInput(value: string) {
  if (editing === "extra") extraInput?.(value);
  if (editing === "email") email = value;
  if (editing === "password") password = value;
  if (editing === "code") code = value;
  if (editing === "body") workspace.editBody(value);
  if (editing === "chat") workspace.setChatDraft(value);
  draw();
}
const choices = (itemList: string[]) => {
  const expected = lifecycle;
  return new Promise<number | undefined>(resolve =>
    wx.showActionSheet({
      itemList,
      success: (r: any) =>
        resolve(expected === lifecycle ? r.tapIndex : undefined),
      fail: () => resolve(undefined),
    })
  );
};
const confirm = (title: string, content: string) => {
  const expected = lifecycle;
  return new Promise<boolean>(resolve =>
    wx.showModal({
      title,
      content,
      success: (r: any) => resolve(expected === lifecycle && r.confirm),
      fail: () => resolve(false),
    })
  );
};
async function guardedSwitch(action: () => Promise<unknown> | unknown) {
  if (!workspace.hasUnsavedChanges()) {
    await action();
    return;
  }
  const selected = await choices(["保存正文后继续", "放弃本机修改后继续"]);
  if (selected === undefined) return;
  if (selected === 0) {
    if (!(await workspace.save())) {
      toast("正文未能安全保存，留在当前故事");
      return;
    }
  } else workspace.discardBody();
  await action();
}
async function wechat(bind: boolean) {
  if (!__WECHAT_ENABLED__ || authPending) return;
  if (
    bind &&
    !(await confirm(
      "关联当前微信",
      "确认把当前微信关联到此邮箱账号？已占用的身份不会自动合并。"
    ))
  )
    return;
  const expected = lifecycle;
  authPending = true;
  try {
    const code = await new Promise<string>((resolve, reject) =>
      wx.login({
        timeout: 10000,
        success: (r: any) => (r.code ? resolve(r.code) : reject(new Error())),
        fail: reject,
      })
    );
    if (expected !== lifecycle) return;
    if (bind) await auth.bindWechat(code);
    else await auth.loginWechat(code);
    if (bind && auth.getState().error) toast(auth.getState().error);
  } catch {
    toast("微信登录暂未成功，请重试");
  } finally {
    authPending = false;
    draw();
  }
}
async function action(command: string) {
  const state = workspace.getState();
  if (command === "logout") {
    await guardedSwitch(() => {
      lifecycle++;
      email = "";
      password = "";
      auth.logout();
    });
    return;
  }
  if (authState.busy || authPending || state.busy) return;
  if (accountWorkspace.getState().busy) return;
  if (command === 'showEmailLogin' || command === 'showWechatLogin') {
    showEmailLogin = command === 'showEmailLogin'; draw(); return;
  }
  if (command === 'linkEmail') {
    view.screen = 'linkEmail'; view.offset = 0; draw(); return;
  }
  if (command === "account") {
    view.screen = "account";
    view.offset = 0;
    draw();
    void accountWorkspace.balance();
    if (!accountWorkspace.getState().profileLoaded)
      await accountWorkspace.load();
    return;
  }
  if (command === "letter") {
    view.screen = "letter";
    view.offset = 0;
    draw();
    if (!accountWorkspace.getState().profileLoaded)
      await accountWorkspace.load();
    return;
  }
  if (command === "balance") {
    await accountWorkspace.balance();
    return;
  }
  if (command === "reloadAccount") {
    await accountWorkspace.load();
    return;
  }
  const extraKeyboard = (
    value: string,
    maxLength: number,
    set: (s: string) => void,
    multiple = false
  ) => {
    editing = "extra";
    extraInput = set;
    wx.showKeyboard({
      defaultValue: value,
      maxLength,
      multiple,
      confirmHold: false,
      confirmType: "done",
      fail: () => {
        editing = null;
        extraInput = null;
        toast("键盘打开失败");
      },
    });
  };
  if (command === 'linkEmailInput' || command === 'linkEmailOtp') {
    const fieldEmail = command === 'linkEmailInput';
    extraKeyboard(fieldEmail ? linkEmail : linkOtp, fieldEmail ? 320 : 6, value => {
      if (fieldEmail) { linkEmail = value; linkOtp = ''; } else linkOtp = value;
    });
    return;
  }
  if (command === 'linkEmailSend') {
    if (!/^\S+@\S+\.\S+$/.test(linkEmail.trim())) { toast('请填写有效邮箱'); return; }
    await auth.requestLinkEmailOtp(linkEmail.trim()); return;
  }
  if (command === 'linkEmailConfirm') {
    if (!/^\S+@\S+\.\S+$/.test(linkEmail.trim()) || !/^\d{6}$/.test(linkOtp)) {
      toast('请填写邮箱和六位验证码'); return;
    }
    if (workspace.hasUnsavedChanges() || state.chatDraft.trim() ||
      (!accountWorkspace.getState().profile && Object.values(accountWorkspace.getState().fields).some(value => value.trim()))) {
      toast('当前还有未保存内容，请先处理，关联不会丢弃草稿。'); return;
    }
    if (!await confirm('确认关联邮箱', `将当前微信与 ${linkEmail.trim()} 关联。已有账号的故事和余额会保留；两边都有内容时暂停，不自动合并。`)) return;
    const expected = lifecycle, address = linkEmail.trim(), otp = linkOtp;
    authPending = true; draw();
    try {
      const freshCode = await new Promise<string>((resolve, reject) => wx.login({ timeout: 10000,
        success: (r: any) => r.code ? resolve(r.code) : reject(new Error()), fail: reject }));
      if (expected !== lifecycle) return;
      if (await auth.linkEmail(address, otp, freshCode)) toast('关联成功，下次仍可直接微信登录。');
    } catch { toast('微信验证暂未成功，请重试。'); }
    finally { authPending = false; linkOtp = ''; draw(); }
    return;
  }
  if (command.startsWith("field:")) {
    const field = command.slice(6) as keyof BirthFields;
    if (
      ![
        "birthDate",
        "birthTime",
        "birthPlace",
        "currentLocation",
        "userMessage",
      ].includes(field)
    )
      return;
    extraKeyboard(
      accountWorkspace.getState().fields[field],
      field === "userMessage"
        ? 800
        : field === "birthDate"
          ? 10
          : field === "birthTime"
            ? 5
            : 80,
      value => accountWorkspace.setField(field, value),
      field === "userMessage"
    );
    return;
  }
  if (command === "saveProfile") {
    if (await confirm("保存出生信息", EMOTION_ANALYSIS_CONSENT_TEXT))
      await accountWorkspace.saveProfile();
    return;
  }
  if (command === "letterEdit") {
    accountWorkspace.beginMessage();
    view.screen = "letterEdit";
    view.offset = 0;
    draw();
    return;
  }
  if (command === "editLetterMessage") {
    extraKeyboard(
      accountWorkspace.getState().messageDraft,
      800,
      value => accountWorkspace.setMessage(value),
      true
    );
    return;
  }
  if (command === "saveLetterMessage") {
    await accountWorkspace.saveMessage();
    if (!accountWorkspace.getState().error) {
      view.screen = "letter";
      view.offset = 0;
      draw();
    }
    return;
  }
  if (command === "reread") {
    if (
      await confirm(
        "再读一遍",
        "按这一天的资料重新生成回信；网络失败后重试会沿用同一次请求。"
      )
    )
      await accountWorkspace.reread();
    return;
  }
  if (command === "letterDates") {
    const dates = [
      ...new Set([
        getTodayNayin().cstDateStr,
        ...accountWorkspace.getState().letters.map(l => l.letterDate),
      ]),
    ]
      .sort()
      .reverse();
    let page = 0;
    while (true) {
      const chunk = dates.slice(page * 5, page * 5 + 5),
        more = dates.length > (page + 1) * 5;
      const index = await choices([...chunk, ...(more ? ["更早的来信…"] : [])]);
      if (index === undefined) return;
      if (index === chunk.length) {
        page++;
        continue;
      }
      accountWorkspace.setDate(chunk[index]);
      view.offset = 0;
      draw();
      return;
    }
  }
  if (command === "email" || command === "password" || command === "code") {
    keyboard(command);
    return;
  }
  if (command === "emailMode") {
    emailMode = emailMode === "password" ? "otp" : "password";
    password = "";
    code = "";
    draw();
    return;
  }
  if (command === "requestOtp") {
    if (!email.trim()) {
      toast("请先填写邮箱");
      return;
    }
    await auth.requestEmailOtp(email.trim());
    return;
  }
  if (command === "login") {
    if (emailMode === "otp") {
      if (!email.trim() || !/^\d{6}$/.test(code)) {
        toast("请填写邮箱和六位验证码");
        return;
      }
      const value = code;
      code = "";
      await auth.loginEmailOtp(email.trim(), value);
      return;
    }
    if (!email.trim() || !password) {
      toast("请填写邮箱和密码");
      return;
    }
    const value = password;
    password = "";
    await auth.loginEmail(email.trim(), value);
    return;
  }
  if (command === "wechat" || command === "bind") {
    await wechat(command === "bind");
    return;
  }
  if (command === "stories") {
    view.screen = command;
    view.listOffset = 0;
    draw();
    return;
  }
  if (command === "back") {
    view.screen = "workspace";
    draw();
    return;
  }
  if (command === "sheet") {
    view.stop = view.stop === "peek" ? "half" : "peek";
    view.offset = 0;
    view.chatOffset = 0;
    draw();
    return;
  }
  if (command === "chatInput") {
    keyboard("chat");
    return;
  }
  if (command === "editBody") {
    keyboard("body");
    return;
  }
  if (command === "save") {
    await workspace.save();
    return;
  }
  if (command === "send") {
    await workspace.send();
    return;
  }
  if (command === "refresh") {
    await workspace.refresh();
    return;
  }
  if (command === "reconnect") {
    await workspace.connect();
    return;
  }
  if (command === "refreshChat") {
    await workspace.refreshChat();
    return;
  }
  if (command === "initialize") {
    await workspace.initializeBody();
    return;
  }
  const finish = () => {
    view.screen = "workspace";
    view.offset = 0;
    view.chatOffset = 0;
    draw();
  };
  if (command === "create") {
    await guardedSwitch(async () => {
      if (await workspace.createStory()) finish();
    });
    return;
  }
  if (command.startsWith("story:")) {
    await guardedSwitch(async () => {
      if (await workspace.select(Number(command.slice(6)))) finish();
    });
    return;
  }
  if (command === "conflict") {
    view.screen = "conflict";
    view.offset = 0;
    draw();
    return;
  }
  if (command === "copyBody") {
    wx.setClipboardData({ data: state.document?.body ?? "" });
    return;
  }
  if (command === "useLatest" && state.document?.conflict?.latestDocument) {
    if (
      await confirm(
        "载入最新正文",
        "将放弃这次尚未保存的本机修改。建议先复制保留。"
      )
    ) {
      workspace.discardBody();
      view.screen = "workspace";
      view.offset = 0;
      draw();
    }
    return;
  }
  if (command.startsWith("recovery:")) {
    const id = command.slice(9),
      turn = state.turns.find(t => t.clientTurnId === id);
    if (!turn) return;
    const selection = await choices([
      "恢复这条回答",
      "复制保留的内容",
      "移除本机恢复提示",
    ]);
    if (selection === undefined) return;
    if (selection === 1) {
      wx.setClipboardData({ data: turn.assistantContent || turn.userContent });
      return;
    }
    if (selection === 2) {
      workspace.discardTurn(id);
      return;
    }
    if (
      turn?.status === "generation-failed" &&
      !(await confirm(
        "重试这条消息",
        "上次生成已明确失败，是否重新发起这一次生成？"
      ))
    )
      return;
    await workspace.retryTurn(id);
  }
}
wx.onKeyboardInput((event: { value: string }) => {
  try {
    changeInput(event.value);
  } catch {
    toast("草稿保存失败，请先复制内容");
  }
});
wx.onKeyboardComplete((event: { value?: string }) => {
  try {
    if (typeof event.value === "string") changeInput(event.value);
  } catch {
    toast("草稿保存失败，请先复制内容");
  } finally {
    editing = null;
    view.keyboardHeight = 0;
    draw();
  }
});
wx.onKeyboardHeightChange?.((event: { height: number }) => {
  view.keyboardHeight = event.height;
  draw();
});
wx.onTouchStart((event: any) => {
  const t = event.touches[0];
  if (!t) return;
  touch = {
    x: t.clientX,
    y: t.clientY,
    sheet:
      view.screen === "workspace" &&
      t.clientY >= layout.sheetTop &&
      t.clientY <= layout.sheetTop + 58,
    top: layout.sheetTop,
  };
});
wx.onTouchMove?.((event: any) => {
  if (!touch?.sheet || editing) return;
  const t = event.touches[0];
  if (t) {
    view.dragTop = Math.max(
      view.safeTop + 24,
      Math.min(height - view.safeBottom - 192, touch.top + t.clientY - touch.y)
    );
    draw();
  }
});
wx.onTouchEnd((event: any) => {
  const t = event.changedTouches[0],
    start = touch;
  touch = null;
  if (!t || !start || editing) return;
  const delta = start.y - t.clientY;
  if (Math.abs(delta) > 12) {
    if (start.sheet) {
      const available = height - view.safeBottom - 64 - view.safeTop;
      const used =
        height - view.safeBottom - 64 - (view.dragTop ?? start.top - delta);
      view.stop =
        used > available * 0.7
          ? "full"
          : used > available * 0.3
            ? "half"
            : "peek";
      view.dragTop = null;
    } else if (view.screen === "stories")
      view.listOffset = Math.max(
        0,
        Math.min(layout.maxList, view.listOffset + Math.round(delta / 60))
      );
    else if (start.y < layout.sheetTop)
      view.offset = Math.max(
        0,
        Math.min(layout.maxBody, view.offset + Math.round(delta / 28))
      );
    else
      view.chatOffset = Math.max(
        0,
        Math.min(layout.maxChat, view.chatOffset - Math.round(delta / 25))
      );
    draw();
    return;
  }
  view.dragTop = null;
  const target = [...hits]
    .reverse()
    .find(
      hit =>
        t.clientX >= hit.x &&
        t.clientX <= hit.x + hit.w &&
        t.clientY >= hit.y &&
        t.clientY <= hit.y + hit.h
    );
  if (target)
    void action(target.action).catch(error => toast(workspaceError(error)));
});
wx.onTouchCancel?.(() => {
  touch = null;
  view.dragTop = null;
  draw();
});
wx.onHide(() => {
  password = "";
  code = "";
  editing = null;
  view.keyboardHeight = 0;
});
wx.onShow(() => {
  auth.resume();
  theme();
  draw();
});
wx.onWindowResize?.(() => {
  size();
  draw();
});
size();
try {
  view.font = wx.loadFont?.("brand.ttf") || "serif";
} catch {}
for (const element of ["metal", "wood", "water", "fire", "earth"]) {
  const img = wx.createImage();
  img.onload = () => {
    images[element] = img;
    draw();
  };
  img.src = `character-${element}.png`;
}
draw();
