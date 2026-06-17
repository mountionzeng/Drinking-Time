import { describe, expect, it } from "vitest";
import { buildConfirmedIntentLine } from "./routers";

describe("storyAgent.classify confirmed intent injection", () => {
  it("includes target role and channel for job-search scripts", () => {
    const line = buildConfirmedIntentLine({
      purpose: "linkedin_job_search",
      audience: "recruiters",
      platform: "linkedin",
      tone: "清晰、专业",
      desiredEffect: "让招聘者快速看见竞争力",
      targetRole: "产品经理",
      channel: "linkedin",
    });

    expect(line).toContain("用途=linkedin_job_search");
    expect(line).toContain("目标岗位=产品经理");
    expect(line).toContain("投放=linkedin");
    expect(line).toContain("剧本优先服务这个岗位的竞争力与该平台的时长/正式度");
  });

  it("keeps the old line shape when new optional fields are absent", () => {
    expect(
      buildConfirmedIntentLine({
        purpose: "linkedin_job_search",
        audience: "recruiters",
        platform: "linkedin",
        tone: "清晰、专业",
        desiredEffect: "让招聘者看见能力",
      }),
    ).toBe(
      "【用户已确认意图】用途=linkedin_job_search；给谁看=recruiters；平台=linkedin；调性=清晰、专业；想要的效果=让招聘者看见能力。剧本的叙事方式、节奏、精致度都严格贴合这个意图。",
    );
  });

  it("does not append job-specific guidance for non-job purposes", () => {
    const line = buildConfirmedIntentLine({
      purpose: "social_post",
      audience: "friends",
      platform: "wechat",
      tone: "轻松",
      desiredEffect: "适合分享",
      targetRole: "产品经理",
      channel: "linkedin",
    });

    expect(line).toContain("用途=social_post");
    expect(line).not.toContain("目标岗位");
    expect(line).not.toContain("剧本优先服务");
  });

  it("returns an empty line when no intent is confirmed", () => {
    expect(buildConfirmedIntentLine(null)).toBe("");
    expect(buildConfirmedIntentLine(undefined)).toBe("");
  });
});
