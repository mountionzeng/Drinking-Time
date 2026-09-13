import {
  buildEmotionAnalysisProfile,
  normalizeEmotionAnalysisProfile,
  normalizeEmotionDailyLetter,
  EMOTION_ANALYSIS_CONSENT_TEXT,
  type EmotionAnalysisProfile,
  type EmotionDailyLetterRecord,
} from "../../client/src/features/analysis/emotionAnalysis";
import { getTodayNayin } from "../../client/src/features/nayin/nayin";
import type { MobileDocumentStorage } from "../../client/src/features/mobileWorkspace/mobileDocumentStore";
import type { WorkspaceCall } from "./workspaceClient";
import { workspaceError } from "./workspaceClient";
import {
  COMPUTE_STATEMENT_PAGE_LIMIT,
  parseComputeAccountStatement,
  type ComputeAccountStatement,
  type ComputeStatementItem,
} from "../../shared/computeStatement";
export { EMOTION_ANALYSIS_CONSENT_TEXT };
export type BirthFields = {
  birthDate: string;
  birthTime: string;
  birthPlace: string;
  currentLocation: string;
  userMessage: string;
};
export type AccountWorkspaceState = {
  busy: boolean;
  error: string;
  profile: EmotionAnalysisProfile | null;
  letters: EmotionDailyLetterRecord[];
  date: string;
  balance: {
    postedMinor: number;
    reservedMinor: number;
    availableMinor: number;
    lifetimeSpentMinor: number;
  } | null;
  statement: ComputeAccountStatement | null;
  statementBusy: boolean;
  statementError: string;
  fields: BirthFields;
  messageDraft: string;
  profileLoaded: boolean;
};
const empty = (): AccountWorkspaceState => ({
  busy: false,
  error: "",
  profile: null,
  letters: [],
  date: getTodayNayin().cstDateStr,
  balance: null,
  statement: null,
  statementBusy: false,
  statementError: "",
  fields: {
    birthDate: "",
    birthTime: "",
    birthPlace: "",
    currentLocation: "",
    userMessage: "",
  },
  messageDraft: "",
  profileLoaded: false,
});
export function createAccountWorkspace(
  call: WorkspaceCall,
  storage: MobileDocumentStorage,
  changed: () => void
) {
  let state = empty(),
    epoch = 0,
    scope = "";
  const emit = (patch: Partial<AccountWorkspaceState>) => {
    state = { ...state, ...patch };
    changed();
  };
  const selected = () =>
    state.letters.find(l => l.letterDate === state.date) ?? null;
  async function run(fn: (expected: number) => Promise<void>) {
    if (state.busy) return;
    const expected = epoch;
    emit({ busy: true, error: "" });
    try {
      await fn(expected);
    } catch (error) {
      if (expected === epoch) emit({ error: workspaceError(error) });
    } finally {
      if (expected === epoch) emit({ busy: false });
    }
  }
  async function letters(expected: number) {
    const raw = await call<unknown[]>("letters.list", { limit: 90 });
    if (expected === epoch)
      emit({
        letters: raw
          .map(normalizeEmotionDailyLetter)
          .filter((l): l is EmotionDailyLetterRecord => l !== null),
      });
  }
  function mergeStatementItems(
    current: ComputeStatementItem[],
    incoming: ComputeStatementItem[]
  ): ComputeStatementItem[] {
    // 两笔消费可能在同一毫秒、同金额、同类型；没有公开内部 id 时不能按展示字段
    // 去重，否则会把真实账目吞掉。statementBusy 已保证同一页不会被并发追加。
    return [...current, ...incoming].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt)
    );
  }
  async function readStatement(
    expected: number,
    offsets: { attentionOffset: number; historyOffset: number }
  ) {
    const raw = await call<unknown>("account.statement", {
      ...offsets,
      attentionLimit: COMPUTE_STATEMENT_PAGE_LIMIT,
      historyLimit: COMPUTE_STATEMENT_PAGE_LIMIT,
    });
    const statement = parseComputeAccountStatement(raw);
    if (!statement) throw new Error("statement_incompatible");
    if (expected !== epoch) return null;
    return statement;
  }
  return {
    getState: () => state,
    selected,
    disconnect() {
      epoch++;
      scope = "";
      state = empty();
      changed();
    },
    setScope(value: string) {
      if (scope !== value) {
        epoch++;
        state = empty();
        scope = value;
        changed();
      }
    },
    async balance() {
      const expected = epoch;
      try {
        const balance =
          await call<AccountWorkspaceState["balance"]>("account.balance");
        if (expected === epoch) emit({ balance });
      } catch {
        if (expected === epoch) emit({ balance: null });
      }
    },
    async statement() {
      if (state.statementBusy) return;
      const expected = epoch;
      emit({ statementBusy: true, statementError: "" });
      try {
        const statement = await readStatement(expected, {
          attentionOffset: 0,
          historyOffset: 0,
        });
        if (statement)
          emit({ statement, balance: statement.balance, statementError: "" });
      } catch (error) {
        if (expected === epoch) emit({ statementError: workspaceError(error) });
      } finally {
        if (expected === epoch) emit({ statementBusy: false });
      }
    },
    async moreStatement(section: "attention" | "history") {
      if (state.statementBusy || !state.statement) return;
      const current = state.statement;
      if (
        (section === "attention" && !current.attentionHasMore) ||
        (section === "history" && !current.historyHasMore)
      )
        return;
      const expected = epoch;
      emit({ statementBusy: true, statementError: "" });
      try {
        const next = await readStatement(expected, {
          attentionOffset:
            section === "attention" ? current.attentionItems.length : 0,
          historyOffset:
            section === "history" ? current.historyItems.length : 0,
        });
        if (!next || expected !== epoch) return;
        emit({
          balance: next.balance,
          statement: {
            ...next,
            attentionItems:
              section === "attention"
                ? mergeStatementItems(
                    current.attentionItems,
                    next.attentionItems
                  )
                : current.attentionItems,
            attentionHasMore:
              section === "attention"
                ? next.attentionHasMore
                : current.attentionHasMore,
            attentionTruncated:
              section === "attention"
                ? next.attentionTruncated
                : current.attentionTruncated,
            historyItems:
              section === "history"
                ? mergeStatementItems(current.historyItems, next.historyItems)
                : current.historyItems,
            historyHasMore:
              section === "history"
                ? next.historyHasMore
                : current.historyHasMore,
            historyTruncated:
              section === "history"
                ? next.historyTruncated
                : current.historyTruncated,
          },
        });
      } catch (error) {
        if (expected === epoch) emit({ statementError: workspaceError(error) });
      } finally {
        if (expected === epoch) emit({ statementBusy: false });
      }
    },
    load() {
      return run(async expected => {
        const raw = await call("profile.read");
        if (expected !== epoch) return;
        const profile = normalizeEmotionAnalysisProfile(raw, "server");
        const seed = profile?.analysisSeed;
        emit({
          profile,
          profileLoaded: true,
          fields: {
            birthDate: profile?.birthDate ?? "",
            birthTime: seed?.birthTime ?? "",
            birthPlace: seed?.birthPlace ?? "",
            currentLocation: seed?.currentLocation ?? "",
            userMessage: seed?.userMessage ?? "",
          },
        });
        await letters(expected);
      });
    },
    setField(key: keyof BirthFields, value: string) {
      emit({ fields: { ...state.fields, [key]: value } });
    },
    setDate(date: string) {
      emit({ date, messageDraft: "" });
    },
    setMessage(messageDraft: string) {
      emit({ messageDraft });
    },
    beginMessage() {
      emit({ messageDraft: selected()?.userMessage ?? "" });
    },
    saveProfile() {
      return run(async expected => {
        const profile = buildEmotionAnalysisProfile(
          {
            ...state.fields,
            messageHistory: state.profile?.analysisSeed.messageHistory,
          },
          getTodayNayin(),
          null
        );
        if (!profile) {
          emit({ error: "请填写有效生日，格式为 YYYY-MM-DD。" });
          return;
        }
        if (
          state.fields.birthTime &&
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(state.fields.birthTime)
        ) {
          emit({ error: "时辰请填 HH:mm，不确定可以留空。" });
          return;
        }
        const raw = await call("profile.save", {
          birthDate: profile.birthDate,
          dailyReference: profile.dailyReference,
          analysisSeed: profile.analysisSeed,
          consentAccepted: true,
          consentText: EMOTION_ANALYSIS_CONSENT_TEXT,
        });
        if (expected !== epoch) return;
        emit({
          profile: normalizeEmotionAnalysisProfile(raw, "server"),
          date: getTodayNayin().cstDateStr,
        });
        await letters(expected);
      });
    },
    saveMessage() {
      return run(async expected => {
        const letter = selected();
        if (!letter) return;
        await call("letters.rewrite", {
          letterDate: letter.letterDate,
          expectedRevision: letter.revision,
          userMessage: state.messageDraft.trim(),
        });
        if (expected === epoch) await letters(expected);
      });
    },
    reread() {
      return run(async expected => {
        const letter = selected();
        if (!letter || !scope) return;
        const key = `dk:workspace:${scope}:reread:${letter.letterDate}`;
        // Persist the exact request before calling: uncertain retries keep revision + actionId.
        let pending: {
          letterDate: string;
          expectedRevision: number;
          actionId: string;
        } | null = null;
        try {
          const value = JSON.parse(storage.getItem(key) || "null");
          if (
            value?.letterDate === letter.letterDate &&
            Number.isInteger(value.expectedRevision) &&
            typeof value.actionId === "string"
          )
            pending = value;
        } catch {}
        pending ??= {
          letterDate: letter.letterDate,
          expectedRevision: letter.revision,
          actionId: `game-reread-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        };
        storage.setItem(key, JSON.stringify(pending));
        await call("letters.reread", pending);
        if (expected !== epoch) return;
        storage.removeItem(key);
        await letters(expected);
      });
    },
  };
}
