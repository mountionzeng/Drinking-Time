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
