import { describe, expect, it, vi } from "vitest";
import {
  documentTitleForVisualTheme,
  readVisualThemeMode,
  VISUAL_THEME_STORAGE_KEY,
  writeVisualThemeMode,
} from "./visualTheme";

describe("visual theme preference", () => {
  it("restores the original document title for the Nayin interface", () => {
    expect(documentTitleForVisualTheme("shiguang")).toBe("拾光家忆");
    expect(documentTitleForVisualTheme("nayin")).toBe(
      "Drinking Time - Analysis Engine"
    );
  });

  it("uses the Shiguang illustration theme when no preference exists", () => {
    expect(readVisualThemeMode(null)).toBe("shiguang");
    expect(readVisualThemeMode({ getItem: () => null, setItem: vi.fn() })).toBe(
      "shiguang"
    );
  });

  it("restores only the supported Nayin preference", () => {
    expect(
      readVisualThemeMode({ getItem: () => "nayin", setItem: vi.fn() })
    ).toBe("nayin");
    expect(
      readVisualThemeMode({ getItem: () => "unknown", setItem: vi.fn() })
    ).toBe("shiguang");
  });

  it("persists a user choice without failing when storage is blocked", () => {
    const setItem = vi.fn();
    writeVisualThemeMode({ getItem: vi.fn(), setItem }, "nayin");
    expect(setItem).toHaveBeenCalledWith(VISUAL_THEME_STORAGE_KEY, "nayin");
    expect(() =>
      writeVisualThemeMode(
        {
          getItem: vi.fn(),
          setItem: () => {
            throw new Error("blocked");
          },
        },
        "shiguang"
      )
    ).not.toThrow();
  });
});
