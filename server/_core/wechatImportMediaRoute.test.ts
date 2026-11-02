import { beforeEach, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  owns: vi.fn(),
  read: vi.fn(),
}));
vi.mock("./mediaRouteAuth", () => ({ resolveMediaRouteUserId: mocks.user }));
vi.mock("../repositories/wechatBookImport", () => ({
  ownsWechatImportImage: mocks.owns,
}));
vi.mock("../chapterMediaStore", () => ({ readChapterMedia: mocks.read }));
import { handleWechatImportMedia } from "./wechatImportMediaRoute";
const file = "a".repeat(64) + ".png";
function response() {
  const res = {
    setHeader: vi.fn(),
    sendStatus: vi.fn(),
    type: vi.fn(),
    send: vi.fn(),
  };
  res.type.mockReturnValue(res);
  return res;
}
async function request(name = file) {
  const res = response();
  await handleWechatImportMedia(
    { params: { file: name } } as unknown as Request,
    res as unknown as Response
  );
  return res;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue(10);
  mocks.owns.mockResolvedValue(true);
  mocks.read.mockResolvedValue(Buffer.from("image"));
});
it("requires authentication before checking or reading an image", async () => {
  mocks.user.mockResolvedValue(null);
  const res = await request();
  expect(res.sendStatus).toHaveBeenCalledWith(401);
  expect(mocks.owns).not.toHaveBeenCalled();
  expect(mocks.read).not.toHaveBeenCalled();
});
it("checks this account's imported media before reading bytes", async () => {
  mocks.owns.mockResolvedValue(false);
  const res = await request();
  expect(mocks.owns).toHaveBeenCalledWith(10, `chapters/10/${file}`);
  expect(res.sendStatus).toHaveBeenCalledWith(404);
  expect(mocks.read).not.toHaveBeenCalled();
});
it.each(["../private.png", "b".repeat(64) + ".svg", "chapters/11/" + file])(
  "rejects invalid paths %s",
  async name => {
    expect((await request(name)).sendStatus).toHaveBeenCalledWith(404);
    expect(mocks.read).not.toHaveBeenCalled();
  }
);
it("serves validated bytes privately and never caches authorization", async () => {
  const res = await request();
  expect(res.type).toHaveBeenCalledWith("image/png");
  expect(res.setHeader).toHaveBeenCalledWith(
    "Cache-Control",
    "private, no-store"
  );
  expect(res.send).toHaveBeenCalledWith(Buffer.from("image"));
  mocks.user.mockResolvedValue(11);
  mocks.owns.mockResolvedValue(false);
  expect((await request()).sendStatus).toHaveBeenCalledWith(404);
  expect(mocks.read).toHaveBeenCalledTimes(1);
});
