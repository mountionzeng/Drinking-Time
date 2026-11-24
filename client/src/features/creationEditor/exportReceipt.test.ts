import { expect, it } from "vitest";
import { getExportWarnings, exportReceiptKey, readExportReceipt, saveExportReceipt } from "./exportReceipt";
it("restores exports only for their account and story and rejects unsafe or corrupt links", () => {
  const values = new Map<string, string>();
  const store = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  const a = exportReceiptKey(48, 1217)!;
  const receipt = { storyId: 1217, videoUrl: "/api/videos/export-1217-123.mp4", durationSec: 68, mediaDiagnostics: ["26.27–68.00s has no picture"] };
  saveExportReceipt(store, a, receipt);
  expect(readExportReceipt(store, a, 1217)).toEqual(receipt);
  expect(readExportReceipt(store, exportReceiptKey(49, 1217), 1217)).toBeNull();
  expect(readExportReceipt(store, a, 1218)).toBeNull();
  expect(exportReceiptKey(null, 1217)).toBeNull();
  for (const url of ["javascript:alert(1)", "https://example.invalid/file.mp4", "/api/videos/export-1218-123.mp4"]) {
    store.setItem(a, JSON.stringify({ ...receipt, videoUrl: url }));
    expect(readExportReceipt(store, a, 1217)).toBeNull();
  }
  store.setItem(a, "broken"); expect(readExportReceipt(store, a, 1217)).toBeNull();
});

it("hides legacy notices about intentionally silent media and keeps actual export warnings", () => {
  expect(getExportWarnings({ mediaDiagnostics: [
    "视频 primary:review-take-1651:take-1651 本身没有音轨，已安全跳过原声",
    "26.27–68.00s 无画面 / No picture; retained timeline gap",
  ] })).toEqual(["26.27–68.00s 无画面 / No picture; retained timeline gap"]);
});
