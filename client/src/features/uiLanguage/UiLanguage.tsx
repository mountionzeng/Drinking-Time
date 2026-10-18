import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import messages from "./messages.json";

export type UiLanguage = "zh" | "en" | "fr";
export const UI_LANGUAGES = [
  { id: "zh", label: "中文" },
  { id: "en", label: "English" },
  { id: "fr", label: "Français" },
] as const;
export const UI_LANGUAGE_KEY = "drinking-time.ui-language";
export function validUiLanguage(value: unknown): value is UiLanguage {
  return value === "zh" || value === "en" || value === "fr";
}
export function readUiLanguage(): UiLanguage {
  try {
    const value = window.localStorage.getItem(UI_LANGUAGE_KEY);
    return validUiLanguage(value) ? value : "zh";
  } catch {
    return "zh";
  }
}
/** Only translate explicit interface copy, never user content or API payloads. */
export function translateUi(
  language: UiLanguage,
  source: string,
  values: readonly (string | number | null | undefined)[] = []
): string {
  const text =
    language === "zh"
      ? source
      : ((messages as Record<string, { en: string; fr: string }>)[source]?.[
          language
        ] ?? source);
  return text.replace(/\{(\d+)\}/g, (placeholder, index) =>
    String(values[Number(index)] ?? placeholder)
  );
}
export const UiLanguageContext = createContext<{
  language: UiLanguage;
  setLanguage: (language: UiLanguage) => void;
}>({ language: "zh", setLanguage: () => {} });

export function UiLanguageProvider({
  children,
  mobileTypography = true,
}: {
  children: React.ReactNode;
  mobileTypography?: boolean;
}) {
  const [language, setValue] = useState<UiLanguage>(readUiLanguage);
  const value = useMemo(
    () => ({
      language,
      setLanguage(next: UiLanguage) {
        if (!validUiLanguage(next)) return;
        setValue(next);
        try {
          window.localStorage.setItem(UI_LANGUAGE_KEY, next);
        } catch {
          /* Keep the selection for this session. */
        }
      },
    }),
    [language]
  );
  useEffect(() => {
    const previous = document.documentElement.lang;
    const previousMobile =
      document.documentElement.getAttribute("data-mobile-ui");
    if (mobileTypography) document.documentElement.setAttribute("data-mobile-ui", "true");
    document.documentElement.lang = language === "zh" ? "zh-CN" : language;
    return () => {
      document.documentElement.lang = previous;
      if (previousMobile === null)
        document.documentElement.removeAttribute("data-mobile-ui");
      else
        document.documentElement.setAttribute("data-mobile-ui", previousMobile);
    };
  }, [language, mobileTypography]);
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === UI_LANGUAGE_KEY || event.key === null)
        setValue(readUiLanguage());
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  return (
    <UiLanguageContext.Provider value={value}>
      {children}
    </UiLanguageContext.Provider>
  );
}
export function useUiLanguage() {
  return useContext(UiLanguageContext);
}
export function useUiText() {
  const { language } = useUiLanguage();
  return useMemo(
    () =>
      (
        source: string,
        values?: readonly (string | number | null | undefined)[]
      ) =>
        translateUi(language, source, values),
    [language]
  );
}
