import type { WorkspaceState } from "./workspaceClient";
import type { MobileConversationViewMessage } from "../../client/src/features/mobileWorkspace/mobileConversationStore";
export type SheetStop = "peek" | "half" | "full";
export type GameScreen =
  | "workspace"
  | "stories"
  | "account"
  | "conflict"
  | "letter"
  | "letterEdit";
export type Hit = {
  x: number;
  y: number;
  w: number;
  h: number;
  action: string;
};
export type WorkspaceView = {
  screen: GameScreen;
  stop: SheetStop;
  offset: number;
  chatOffset: number;
  listOffset: number;
  safeTop: number;
  safeBottom: number;
  keyboardHeight: number;
  accent: string;
  character: any;
  font: string;
  wechat: boolean;
  dragTop: number | null;
  balanceText?: string;
};
export function renderWorkspace(
  ctx: any,
  w: number,
  h: number,
  state: WorkspaceState,
  view: WorkspaceView,
  messages: MobileConversationViewMessage[]
) {
  const hits: Hit[] = [];
  const top = view.safeTop + 12,
    bottom = h - view.safeBottom;
  const paper = "#faf7f1",
    ink = "#292521",
    muted = "#6b635b",
    border = "#ded8ce";
  const text = (
    value: string,
    x: number,
    y: number,
    size = 15,
    color = ink,
    brand = false
  ) => {
    ctx.font = `${size}px ${brand ? view.font : "sans-serif"}`;
    ctx.fillStyle = color;
    ctx.fillText(value, x, y);
  };
  const box = (
    x: number,
    y: number,
    bw: number,
    bh: number,
    color: string,
    r = 12
  ) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + bw - r, y);
    ctx.quadraticCurveTo(x + bw, y, x + bw, y + r);
    ctx.lineTo(x + bw, y + bh - r);
    ctx.quadraticCurveTo(x + bw, y + bh, x + bw - r, y + bh);
    ctx.lineTo(x + r, y + bh);
    ctx.quadraticCurveTo(x, y + bh, x, y + bh - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.fill();
  };
  const button = (
    label: string,
    x: number,
    y: number,
    bw: number,
    action: string,
    primary = false,
    enabled = true
  ) => {
    box(x, y, bw, 44, primary ? view.accent : "#eee8df");
    text(
      label,
      x + 12,
      y + 28,
      14,
      enabled ? (primary ? "#fff" : ink) : "#a69b8d"
    );
    if (enabled) hits.push({ x, y, w: bw, h: 44, action });
  };
  const wrap = (value: string, width = w - 40, size = 16) => {
    ctx.font = `${size}px sans-serif`;
    const lines: string[] = [];
    let line = "";
    for (const ch of value) {
      if (ch === "\n" || ctx.measureText(line + ch).width > width) {
        lines.push(line);
        line = "";
      }
      if (ch !== "\n") line += ch;
    }
    lines.push(line);
    return lines;
  };
  const clipText = (value: string, max: number) =>
    value.length > max ? value.slice(0, max - 1) + "…" : value;
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, w, h);
  let maxBody = 0,
    maxChat = 0,
    maxList = 0;
  const notice = state.busy || state.error;
  if (view.screen === "conflict") {
    text("处理正文冲突", 20, top + 28, 23, ink, true);
    button("返回", w - 84, top, 64, "back");
    const conflict = state.document?.conflict;
    const lines = [
      "我在小游戏上的正文",
      ...wrap(conflict?.localBody ?? state.document?.body ?? ""),
      "",
      "网页上的最新正文",
      ...wrap(conflict?.latestDocument?.body ?? "暂时无法读取最新正文"),
    ];
    const count = Math.max(1, Math.floor((bottom - top - 205) / 28));
    maxBody = Math.max(0, lines.length - count);
    lines
      .slice(
        Math.min(view.offset, maxBody),
        Math.min(view.offset, maxBody) + count
      )
      .forEach((line, i) =>
        text(
          line,
          20,
          top + 78 + i * 28,
          15,
          line === "我在小游戏上的正文" || line === "网页上的最新正文"
            ? view.accent
            : ink
        )
      );
    button("复制我的正文", 20, bottom - 118, w - 40, "copyBody");
    button(
      "载入最新正文",
      20,
      bottom - 62,
      w - 40,
      "useLatest",
      true,
      Boolean(conflict?.latestDocument)
    );
  } else if (view.screen === "stories") {
    text("聊点其他的", 20, top + 28, 25, ink, true);
    button("返回", w - 84, top, 64, "back");
    button("新建一个故事", 20, top + 52, w - 40, "create", true, !state.busy);
    const rows = Math.max(1, Math.floor((bottom - top - 182) / 68));
    maxList = Math.max(0, state.stories.length - rows);
    state.stories
      .slice(
        Math.min(view.listOffset, maxList),
        Math.min(view.listOffset, maxList) + rows
      )
      .forEach((story, i) => {
        button(
          clipText(story.title || "未命名故事", Math.floor((w - 70) / 16)),
          20,
          top + 118 + i * 68,
          w - 40,
          `story:${story.id}`,
          story.id === state.storyId,
          !state.busy
        );
      });
    if (!state.stories.length)
      text("还没有故事，从新建开始。", 20, top + 140, 15, muted);
  } else if (view.screen === "account") {
    text("我", 20, top + 28, 25, ink, true);
    button("返回", w - 84, top, 64, "back");
    text(state.account?.name || "碎碎念的朋友", 20, top + 87, 20);
    text(
      clipText(state.account?.email || "微信账号", 35),
      20,
      top + 122,
      14,
      muted
    );
    text("与手机网页共用同一个账号和故事", 20, top + 160, 14, muted);
    button(
      "刷新当前故事",
      20,
      top + 192,
      w - 40,
      "refresh",
      false,
      !state.busy
    );
    button(
      "关联当前微信",
      20,
      top + 248,
      w - 40,
      "bind",
      false,
      view.wechat && !state.busy
    );
    if (!view.wechat)
      text("微信登录待服务端配置完成后开放", 20, top + 316, 13, muted);
    button("退出登录", 20, top + 344, w - 40, "logout");
  } else if (!state.storyId) {
    text("碎碎念", 20, top + 28, 25, ink, true);
    text(state.busy ? "正在打开你的工作区…" : "还没有故事", 24, h * 0.4, 22);
    button(
      state.account ? "新建一个故事" : "重新连接",
      24,
      h * 0.4 + 32,
      w - 48,
      state.account ? "create" : "reconnect",
      true,
      !state.busy
    );
    button("退出登录", 24, h * 0.4 + 90, w - 48, "logout");
  } else {
    const navY = bottom - 64,
      usableBottom = Math.min(navY, h - view.keyboardHeight);
    const stopHeight =
      view.stop === "peek"
        ? 128
        : (usableBottom - top) * (view.stop === "half" ? 0.5 : 0.88);
    const sheetTop =
      view.dragTop ?? Math.max(top + 18, usableBottom - stopHeight);
    if (view.stop === "peek") {
      text(view.balanceText ?? "读取余额…", w - 156, top + 23, 13, muted);
    }
    const bodyY = view.stop === "peek" ? top + 62 : top + 20;
    const lines = wrap(
      state.document?.body ||
        (!state.documentError
          ? "在这里继续正文…"
          : "这篇故事的正文暂时无法读取。")
    );
    const visible = Math.max(0, Math.floor((sheetTop - bodyY - 62) / 28));
    maxBody = Math.max(0, lines.length - visible);
    lines
      .slice(
        Math.min(view.offset, maxBody),
        Math.min(view.offset, maxBody) + visible
      )
      .forEach((line, i) => text(line, 20, bodyY + i * 28));
    if (sheetTop > bodyY + 62) {
      const label = state.document
        ? {
            clean: "与服务器一致",
            saved: "已保存",
            dirty: "有未保存的修改",
            saving: "正在保存",
            conflict: "另一端有更新",
            uncertain: "保存结果待确认",
            failed: "保存失败",
            loading: "正在读取",
          }[state.document.status]
        : "尚无正文";
      text(label, 20, sheetTop - 23, 12, muted);
      if (state.document?.status === "conflict")
        button("处理冲突", w - 104, sheetTop - 54, 88, "conflict");
      else if (state.document) {
        hits.push({
          x: 20,
          y: bodyY - 24,
          w: w - 40,
          h: Math.max(0, sheetTop - bodyY - 45),
          action: "editBody",
        });
        button(
          "编辑",
          w - 166,
          sheetTop - 54,
          66,
          "editBody",
          false,
          !state.busy
        );
        button(
          "保存",
          w - 90,
          sheetTop - 54,
          70,
          "save",
          true,
          !state.busy && ["dirty", "failed"].includes(state.document.status)
        );
      } else
        button(
          "开始写",
          w - 104,
          sheetTop - 54,
          88,
          "initialize",
          false,
          !state.busy
        );
    }
    box(0, sheetTop, w, usableBottom - sheetTop, paper, 20);
    ctx.fillStyle = border;
    ctx.fillRect(w / 2 - 18, sheetTop + 8, 36, 4);
    if (view.character)
      ctx.drawImage(view.character, 17, sheetTop + 18, 34, 38);
    if (view.stop !== "peek")
      text("聊聊", 60, sheetTop + 42, 17, view.accent, true);
    text(
      view.stop === "peek" ? "拉开看全部 ⌃" : "收起 ⌄",
      w - 111,
      sheetTop + 42,
      12,
      muted
    );
    hits.push({ x: 0, y: sheetTop, w, h: 58, action: "sheet" });
    const inputY = usableBottom - 62;
    if (view.stop !== "peek") {
      const chatTop = sheetTop + 62,
        chatBottom = inputY - 42,
        available = Math.max(0, chatBottom - chatTop);
      const bubbles = messages.map(message => {
        const lines = wrap(message.content, (w - 24) * 0.85 - 28, 15);
        ctx.font = "15px sans-serif";
        return {
          message,
          lines,
          width: Math.min(
            (w - 24) * 0.85,
            Math.max(90, ...lines.map(line => ctx.measureText(line).width + 28))
          ),
          height:
            lines.length * 24 + 20 + (message.role === "assistant" ? 30 : 0),
        };
      });
      const thinking = state.busy === "正在回复…";
      const total =
        bubbles.reduce((sum, bubble) => sum + bubble.height + 12, 0) +
        (thinking ? 54 : 0);
      maxChat = Math.max(0, Math.ceil((total - available) / 25));
      let y =
        chatTop -
        Math.max(0, total - available) +
        Math.min(view.chatOffset, maxChat) * 25;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, chatTop, w, available);
      ctx.clip();
      for (const bubble of bubbles) {
        const user = bubble.message.role === "user";
        const x = user ? w - 12 - bubble.width : 12;
        if (y + bubble.height >= chatTop && y <= chatBottom) {
          box(
            x,
            y,
            bubble.width,
            bubble.height,
            user ? view.accent : paper,
            16
          );
          if (!user) {
            ctx.strokeStyle = border;
            ctx.lineWidth = 0.7;
            ctx.stroke();
            if (view.character)
              ctx.drawImage(view.character, x + 12, y + 6, 26, 29);
            text("聊聊", x + 44, y + 25, 10, muted);
          }
          bubble.lines.forEach((line, i) =>
            text(
              line,
              x + 14,
              y + 25 + (user ? 0 : 30) + i * 24,
              15,
              user ? "#fff" : ink
            )
          );
        }
        y += bubble.height + 12;
      }
      if (thinking) {
        if (view.character) ctx.drawImage(view.character, 12, y, 34, 38);
        box(52, y, 64, 36, "#eee8df");
        text("···", 70, y + 25, 22, muted);
      }
      if (!messages.length && !thinking)
        text(
          state.chatReady ? "从一个念头开始，慢慢聊。" : "聊天记录暂时无法读取",
          20,
          chatTop + 40,
          15,
          muted
        );
      ctx.restore();
      if (!state.chatReady)
        button(
          "重试聊天记录",
          20,
          chatTop + 56,
          144,
          "refreshChat",
          false,
          !state.busy
        );
      const pending = state.turns.find(t => t.status !== "synced");
      if (pending && !thinking) {
        text("回答已保留，等待处理", 20, inputY - 16, 12, muted);
        hits.push({
          x: w - 116,
          y: inputY - 39,
          w: 100,
          h: 28,
          action: `recovery:${pending.clientTurnId}`,
        });
        text("恢复回答", w - 94, inputY - 16, 12, view.accent);
      }
    }
    box(16, inputY, w - 92, 46, "#eee8df");
    text(
      clipText(
        state.chatDraft || "继续聊聊…",
        Math.max(6, Math.floor((w - 115) / 15))
      ),
      27,
      inputY + 29,
      15,
      muted
    );
    hits.push({ x: 16, y: inputY, w: w - 92, h: 46, action: "chatInput" });
    button(
      "发送",
      w - 68,
      inputY,
      56,
      "send",
      true,
      state.chatReady && !state.busy && Boolean(state.chatDraft.trim())
    );
    if (!view.keyboardHeight) {
      ctx.strokeStyle = border;
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      ctx.moveTo(14, navY + 31);
      ctx.quadraticCurveTo(w / 2, navY + 27, w - 14, navY + 33);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(31, navY + 36);
      ctx.lineTo(29, navY + 53);
      ctx.moveTo(w - 30, navY + 36);
      ctx.lineTo(w - 28, navY + 53);
      ctx.stroke();
      if (view.character)
        ctx.drawImage(view.character, w / 2 - 28, navY - 25, 56, 62);
      text("故事", w / 6 - 14, navY + 26, 13);
      text(
        view.stop === "peek" ? "来聊会儿" : "聊点其他的",
        w / 2 - 35,
        navY + 55,
        15,
        view.accent,
        true
      );
      text("我", (w * 5) / 6 - 6, navY + 26, 13);
      hits.push(
        { x: 0, y: navY, w: w / 3, h: 64, action: "stories" },
        {
          x: w / 3,
          y: navY,
          w: w / 3,
          h: 64,
          action: view.stop === "peek" ? "sheet" : "stories",
        },
        { x: (w * 2) / 3, y: navY, w: w / 3, h: 64, action: "account" }
      );
    }
    if (notice) {
      box(12, top + 32, w - 24, 32, "#eee8df", 8);
      text(
        clipText(notice, Math.floor((w - 48) / 12)),
        23,
        top + 53,
        12,
        muted
      );
    }
    return { hits, sheetTop, maxBody, maxChat, maxList };
  }
  if (notice)
    wrap(notice, w - 40, 13)
      .slice(0, 2)
      .forEach((line, i) => text(line, 20, bottom - 46 + i * 19, 13, muted));
  return { hits, sheetTop: h, maxBody, maxChat, maxList };
}
