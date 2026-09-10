import type { AccountWorkspaceState } from "./accountWorkspace";
import type { WorkspaceView, Hit } from "./workspaceView";
import { formatCny } from "../../shared/computeMoney";
import { publicDailyLetterForDate } from "./publicDailyLetter";
export function renderAccount(
  ctx: any,
  w: number,
  h: number,
  state: AccountWorkspaceState,
  view: WorkspaceView,
  email: string,
  screen: "account" | "letter" | "letterEdit" | "linkEmail",
  link = { email: '', otp: '', busy: false, message: '' }
) {
  const hits: Hit[] = [],
    paper = "#faf7f1",
    ink = "#292521",
    muted = "#6b635b";
  const top = view.safeTop + 12,
    bottom = h - view.safeBottom,
    shift = view.offset * 28;
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, w, h);
  const text = (s: string, x: number, y: number, size = 15, color = ink) => {
    ctx.font = `${size}px sans-serif`;
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
  };
  const button = (s: string, y: number, action: string) => {
    const yy = y - shift;
    if (yy < top + 55 || yy + 44 > bottom - 32) return;
    ctx.fillStyle = "#eee8df";
    ctx.fillRect(20, yy, w - 40, 44);
    text(s, 30, yy + 28, 14);
    hits.push({ x: 20, y: yy, w: w - 40, h: 44, action });
  };
  let y = top + 80;
  const para = (value: string, size = 15, color = ink) => {
    let line = "";
    ctx.font = `${size}px sans-serif`;
    const flush = () => {
      if (y - shift > top + 58 && y - shift < bottom - 35)
        text(line, 20, y - shift, size, color);
      y += 28;
      line = "";
    };
    for (const c of value) {
      if (c === "\n" || ctx.measureText(line + c).width > w - 40) flush();
      if (c !== "\n") line += c;
    }
    flush();
    y += 12;
  };
  const action = (label: string, command: string) => {
    button(label, y, command);
    y += 58;
  };
  if (screen === 'linkEmail') {
    para('关联邮箱或已有账号', 22);
    para('不关联也能继续使用微信账号。', 14, muted);
    action(link.email ? `邮箱：${link.email}` : '填写要关联的邮箱', 'linkEmailInput');
    action(link.busy ? '请稍候…' : '发送关联验证码', 'linkEmailSend');
    action(link.otp ? '验证码：已填写' : '填写六位验证码', 'linkEmailOtp');
    action(link.busy ? '正在处理…' : '验证并关联', 'linkEmailConfirm');
    para('已有邮箱账号的故事与余额会保留；当前微信账号已有内容时暂停关联，不自动合并。', 13, muted);
    if (link.message) para(link.message, 14, '#9b493e');
  } else if (screen === "account") {
    para(email || "微信账号", 14, muted);
    if (!email && view.wechat) {
      action('关联邮箱 / 已有账号', 'linkEmail');
      para('可选，不影响当前微信账号的使用。', 13, muted);
    }
    para("还剩多少", 20);
    para(
      state.balance
        ? `可用余额 ${formatCny(state.balance.availableMinor)}`
        : "余额尚未读到",
      19,
      view.accent
    );
    if (state.balance?.reservedMinor)
      para(`生成中预占 ${formatCny(state.balance.reservedMinor)}`, 13, muted);
    if (state.balance && state.balance.availableMinor < 0)
      para("账目异常，请联系我们，先别继续生成。", 13);
    action("刷新余额", "balance");
    action("今天的来信 ›", "letter");
    para("出生信息", 20);
    para("不填也能读信；填写后，来信会结合这些资料。", 13, muted);
    for (const [key, label, hint] of [
      ["birthDate", "生日", "YYYY-MM-DD"],
      ["birthTime", "出生时间", "HH:mm（不知道可留空）"],
      ["birthPlace", "出生地", "选填"],
      ["currentLocation", "现居地", "选填"],
      ["userMessage", "想说的话", "选填"],
    ] as const) {
      action(`${label}：${state.fields[key] || hint}`, `field:${key}`);
    }
    action(state.busy ? "正在保存…" : "保存出生信息", "saveProfile");
    if (email) action(view.wechat ? "关联当前微信" : "微信关联待服务端配置", "bind");
    action("退出登录", "logout");
  } else {
    const letter = state.letters.find(l => l.letterDate === state.date);
    if (screen === "letterEdit") {
      para("修改那天的原话", 20);
      para(state.messageDraft || "点下面的按钮输入");
      action("编辑原话", "editLetterMessage");
      action("保存原话", "saveLetterMessage");
    } else {
      para(`${state.date} 的来信`, 22, view.accent);
      action("选择日期", "letterDates");
      const reference =
        letter?.dailyReference ??
        (state.profile?.dailyReference.todayDate === state.date
          ? state.profile.dailyReference
          : null);
      if (reference) {
        para("当天气息", 18);
        para(reference.lunarLabel, 13, muted);
        para(reference.title, 18);
        para(reference.activity, 15);
        para("那天你这样说", 18);
        para(
          letter?.userMessage ||
            state.profile?.analysisSeed.userMessage ||
            "这一天还没有留下原话。"
        );
        if (letter) action("修改这段原话", "letterEdit");
        para("聊会儿的回信", 18);
        para(reference.summary);
        for (const block of reference.schedule ?? [])
          para(`${block.label} · ${block.title}\n${block.detail}`);
        if (reference.note) para(reference.note, 13, muted);
        if (letter) action("再读一遍", "reread");
      } else if (state.profileLoaded && !state.profile) {
        const publicLetter = publicDailyLetterForDate(state.date);
        para("今天留给大家的一封信", 18);
        para(publicLetter.attention);
        publicLetter.paragraphs.forEach(p => para(p));
      } else
        para(state.busy ? "正在读取来信…" : "这一天的信尚未读取，请刷新。");
      action("刷新来信", "reloadAccount");
    }
  }
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, w, top + 53);
  text(screen === "account" ? "我" : screen === 'linkEmail' ? '关联账号' : "你的每日回信", 20, top + 28, 23);
  text("返回", w - 64, top + 28, 15, view.accent);
  hits.push({
    x: w - 84,
    y: top,
    w: 70,
    h: 44,
    action:
      screen === "letterEdit"
        ? "letter"
        : screen === "letter" || screen === 'linkEmail'
          ? "account"
          : "back",
  });
  if (state.error) {
    ctx.fillStyle = paper;
    ctx.fillRect(0, bottom - 34, w, 34);
    text(
      state.error.slice(0, Math.floor((w - 30) / 12)),
      16,
      bottom - 12,
      12,
      "#9b493e"
    );
  }
  return {
    hits,
    sheetTop: h,
    maxBody: Math.max(0, Math.ceil((y - bottom + 44) / 28)),
    maxChat: 0,
    maxPeekReply: 0,
    maxList: 0,
  };
}
