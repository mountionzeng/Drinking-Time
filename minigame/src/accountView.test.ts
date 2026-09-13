import { expect, it, vi } from "vitest";
import { renderAccount } from "./accountView";
import type { AccountWorkspaceState } from "./accountWorkspace";
import type { WorkspaceView } from "./workspaceView";

it("shows micro-yuan detail, reservations and reconciliation without rounding to zero", () => {
  const drawn: string[] = [];
  const ctx = {
    font: "",
    fillStyle: "",
    fillRect: vi.fn(),
    fillText: (value: string) => drawn.push(value),
    measureText: (value: string) => ({ width: value.length * 8 }),
  };
  const state = {
    busy: false,
    error: "",
    profile: null,
    letters: [],
    date: "2026-09-13",
    balance: null,
    statementBusy: false,
    statementError: "",
    statement: {
      version: 1,
      currency: "CNY",
      balance: {
        postedMinor: 10_000_000,
        reservedMinor: 2_000_000,
        availableMinor: 8_000_000,
        lifetimeSpentMinor: 321,
      },
      attentionItems: [
        {
          createdAt: "2026-09-13T11:00:00.000Z",
          label: "图片生成",
          amountMinor: 0,
          reservedMinor: 2_000_000,
          releasedMinor: 0,
          status: "reconciliation" as const,
          estimated: true,
        },
      ],
      attentionHasMore: false,
      attentionTruncated: false,
      historyItems: [
        {
          createdAt: "2026-09-13T10:00:00.000Z",
          label: "文字生成",
          amountMinor: -321,
          reservedMinor: 0,
          releasedMinor: 0,
          status: "posted" as const,
          estimated: true,
        },
      ],
      historyHasMore: false,
      historyTruncated: false,
      coverageNote: "只显示已进入账本的调用。",
    },
    fields: {
      birthDate: "",
      birthTime: "",
      birthPlace: "",
      currentLocation: "",
      userMessage: "",
    },
    messageDraft: "",
    profileLoaded: false,
  } satisfies AccountWorkspaceState;
  const view = {
    screen: "statement",
    stop: "peek",
    offset: 0,
    chatOffset: 0,
    listOffset: 0,
    safeTop: 0,
    safeBottom: 0,
    keyboardHeight: 0,
    accent: "#927342",
    character: null,
    font: "serif",
    wechat: true,
    dragTop: null,
    peekReplyOffset: 0,
  } satisfies WorkspaceView;

  renderAccount(ctx, 390, 844, state, view, "", "statement");

  expect(drawn).toContain("文字生成  -¥0.000321");
  expect(drawn).toContain("图片生成  -¥2.00（占用）");
  expect(drawn).toContain("待对账 · 估算");
  expect(drawn.indexOf("待处理")).toBeLessThan(drawn.indexOf("历史记录"));
});

it("makes the end of a long statement reachable through body scrolling", () => {
  const drawn: string[] = [];
  const ctx = {
    font: "",
    fillStyle: "",
    fillRect: vi.fn(),
    fillText: (value: string) => drawn.push(value),
    measureText: (value: string) => ({ width: value.length * 8 }),
  };
  const item = (index: number) => ({
    createdAt: `2026-09-${String(13 - (index % 5)).padStart(2, "0")}T10:00:00.000Z`,
    label: `第${index}笔`,
    amountMinor: -321,
    reservedMinor: 0,
    releasedMinor: 0,
    status: "posted" as const,
    estimated: true,
  });
  const state = {
    busy: false,
    error: "",
    profile: null,
    letters: [],
    date: "2026-09-13",
    balance: null,
    statementBusy: false,
    statementError: "",
    statement: {
      version: 1,
      currency: "CNY",
      balance: {
        postedMinor: 10_000_000,
        reservedMinor: 0,
        availableMinor: 10_000_000,
        lifetimeSpentMinor: 321,
      },
      attentionItems: [],
      attentionHasMore: false,
      attentionTruncated: false,
      historyItems: Array.from({ length: 20 }, (_, index) => item(index)),
      historyHasMore: false,
      historyTruncated: false,
      coverageNote: "账单说明已到底",
    },
    fields: {
      birthDate: "",
      birthTime: "",
      birthPlace: "",
      currentLocation: "",
      userMessage: "",
    },
    messageDraft: "",
    profileLoaded: false,
  } satisfies AccountWorkspaceState;
  const view = {
    screen: "statement",
    stop: "peek",
    offset: 0,
    chatOffset: 0,
    listOffset: 0,
    safeTop: 0,
    safeBottom: 0,
    keyboardHeight: 0,
    accent: "#927342",
    character: null,
    font: "serif",
    wechat: true,
    dragTop: null,
    peekReplyOffset: 0,
  } satisfies WorkspaceView;

  const first = renderAccount(ctx, 390, 844, state, view, "", "statement");
  expect(first.maxBody).toBeGreaterThan(0);
  drawn.length = 0;
  view.offset = first.maxBody;
  renderAccount(ctx, 390, 844, state, view, "", "statement");
  expect(drawn.join(" ")).toContain("账单说明已到底");
});
