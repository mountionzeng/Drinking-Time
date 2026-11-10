import { beforeEach, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { artSystemSkillDownload } from "./artSystemSkillDownload";
const mocks = vi.hoisted(() => ({ owner: vi.fn(), auth: vi.fn() }));
vi.mock("./mediaRouteAuth", () => ({ resolveMediaRouteUserId: mocks.auth }));
vi.mock("../repositories/textSourceLineage", () => ({ ownedCreationStory: mocks.owner }));
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue(7); mocks.owner.mockResolvedValue({ body: { artDirection: { recipe: { version: 2, system: { name: "Paper world" } } } } }); });
const req = (storyId = "1", version = "2") => ({ params: { storyId, version } }) as unknown as Request;
const response = () => ({ setHeader: vi.fn(), sendStatus: vi.fn(), send: vi.fn() });
it("serves the requested owned version as a private markdown attachment", async () => {
  const res = response(); await artSystemSkillDownload(req(), res as unknown as Response);
  expect(mocks.owner).toHaveBeenCalledWith({ storyId: 1, userId: 7 });
  expect(res.setHeader).toHaveBeenCalledWith("Content-Disposition", 'attachment; filename="art-system-v2-SKILL.md"');
  expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
  expect(res.send).toHaveBeenCalledWith(expect.stringContaining("Paper world"));
});
it("rejects unauthenticated, foreign, missing and invalid requests without exporting", async () => {
  const res = response();
  mocks.auth.mockResolvedValueOnce(null); await artSystemSkillDownload(req(), res as unknown as Response); expect(res.sendStatus).toHaveBeenLastCalledWith(401);
  mocks.owner.mockRejectedValueOnce(new Error("not owned")); await artSystemSkillDownload(req(), res as unknown as Response); expect(res.sendStatus).toHaveBeenLastCalledWith(404);
  await artSystemSkillDownload(req("1", "99"), res as unknown as Response); expect(res.sendStatus).toHaveBeenLastCalledWith(404);
  await artSystemSkillDownload(req("../9"), res as unknown as Response); expect(res.sendStatus).toHaveBeenLastCalledWith(400);
  expect(res.send).not.toHaveBeenCalled();
});
