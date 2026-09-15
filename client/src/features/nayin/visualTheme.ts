export const VISUAL_THEME_STORAGE_KEY = "drinking-time-visual-theme-v1";

export type VisualThemeMode = "shiguang" | "nayin";

export function documentTitleForVisualTheme(mode: VisualThemeMode): string {
  return mode === "shiguang" ? "拾光家忆" : "Drinking Time - Analysis Engine";
}

type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

export function readVisualThemeMode(
  storage?: ThemeStorage | null
): VisualThemeMode {
  if (!storage) return "shiguang";
  try {
    return storage.getItem(VISUAL_THEME_STORAGE_KEY) === "nayin"
      ? "nayin"
      : "shiguang";
  } catch {
    return "shiguang";
  }
}

export function writeVisualThemeMode(
  storage: ThemeStorage | null | undefined,
  mode: VisualThemeMode
) {
  try {
    storage?.setItem(VISUAL_THEME_STORAGE_KEY, mode);
  } catch {
    // A blocked localStorage must not stop the theme from changing in this tab.
  }
}
