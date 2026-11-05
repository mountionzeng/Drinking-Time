import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const mocks = vi.hoisted(() => ({ oss: vi.fn(), upload: vi.fn(), storage: vi.fn() }));
vi.mock("./publicReferenceHost", () => ({ putPublicReference: mocks.oss, publicReferenceKey: () => "refs/test.png" }));
vi.mock("./videoTransition302", () => ({ uploadFileTo302: mocks.upload }));
vi.mock("../storage", () => ({ storagePut: mocks.storage }));
import { toPublicImageUrl } from "./imageGen";
import { ENV } from "../_core/env";

const saved = { localImageDir: ENV.localImageDir, api302Key: ENV.api302Key };
let dir: string;
let source: string;
beforeEach(() => {
  vi.resetAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "public-reference-"));
  ENV.localImageDir = dir;
  ENV.api302Key = "test-key";
  const name = `${path.basename(dir)}.png`;
  fs.writeFileSync(path.join(dir, name), Buffer.from([137, 80, 78, 71]));
  source = `/api/images/${name}`;
  mocks.oss.mockResolvedValue(undefined);
  mocks.upload.mockResolvedValue("https://files.example.com/reference.png");
});
afterEach(() => {
  ENV.localImageDir = saved.localImageDir;
  ENV.api302Key = saved.api302Key;
  fs.rmSync(dir, { recursive: true, force: true });
});
it("uploads an existing local warehouse image through the supported file endpoint when OSS is absent", async () => {
  expect(await toPublicImageUrl(source)).toBe("https://files.example.com/reference.png");
  expect(mocks.upload).toHaveBeenCalledWith({fileName:path.basename(source),bytes:Buffer.from([137,80,78,71]),contentType:"image/png"});
  expect(mocks.storage).not.toHaveBeenCalled();
  expect(await toPublicImageUrl(source)).toBe("https://files.example.com/reference.png");
  expect(mocks.upload).toHaveBeenCalledTimes(1);
});
it("keeps configured object storage as the first choice", async () => {
  mocks.oss.mockResolvedValue("https://assets.example.com/reference.png");
  expect(await toPublicImageUrl(source)).toBe("https://assets.example.com/reference.png");
  expect(mocks.upload).not.toHaveBeenCalled();
});
it("does not cache a failed upload or silently call the broken storage proxy", async () => {
  mocks.upload.mockRejectedValueOnce(new Error("unavailable"));
  expect(await toPublicImageUrl(source)).toBeUndefined();
  expect(mocks.storage).not.toHaveBeenCalled();
  expect(await toPublicImageUrl(source)).toBe("https://files.example.com/reference.png");
});
it("rejects a non-HTTPS upload response", async () => {
  mocks.upload.mockResolvedValue("http://localhost:3000/reference.png");
  expect(await toPublicImageUrl(source)).toBeUndefined();
});
