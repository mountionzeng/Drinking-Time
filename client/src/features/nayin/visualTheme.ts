export const VISUAL_THEME_STORAGE_KEY = "drinking-time-visual-theme-v1";
export const VISUAL_THEME_ENTRY_PARAMETER = "visualTheme";

export type VisualThemeMode = "shiguang" | "nayin";

export function documentTitleForVisualTheme(_mode: VisualThemeMode): string {
  return "Drinking Time - Analysis Engine";
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

export function readVisualThemeEntry(search: string): VisualThemeMode | null {
  const values = new URLSearchParams(search).getAll(VISUAL_THEME_ENTRY_PARAMETER);
  return values.length === 1 && values[0] === "nayin" ? "nayin" : null;
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
