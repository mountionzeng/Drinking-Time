import { describe, expect, it } from "vitest";
import { buildConfirmedIntentLine } from "./routers/_storyShared";

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
      })
    ).toBe(
      "【用户已确认意图】用途=linkedin_job_search；给谁看=recruiters；平台=linkedin；调性=清晰、专业；想要的效果=让招聘者看见能力。剧本的叙事方式、节奏、精致度都严格贴合这个意图。"
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

  it("makes self-reflection serve understanding rather than external persuasion", () => {
    const line = buildConfirmedIntentLine({
      purpose: "self_reflection",
      audience: "self",
      platform: "private_archive",
      tone: "坦诚、细腻",
      desiredEffect: "看清自己的选择和变化",
    });

    expect(line).toContain("服务用户理解自己");
    expect(line).toContain("允许开放结尾");
    expect(line).toContain("不按外部观众的说服效率包装");
  });

  it("keeps raw records factual instead of forcing a story arc", () => {
    const line = buildConfirmedIntentLine({
      purpose: "raw_record",
      audience: "self",
      platform: "private_archive",
      tone: "克制、纪实",
      desiredEffect: "先准确留下这件事",
    });

    expect(line).toContain("保存事实、原话、动作、时间顺序和感官细节");
    expect(line).toContain("不要强行制造冲突");
  });

  it.each([
    {
      purpose: "portfolio",
      expected: "让观众理解这个人是谁、在意什么、做过什么",
    },
    {
      purpose: "gift",
      expected: "保留双方关系里的专属称呼、事件和私人细节",
    },
    {
      purpose: "social_post",
      expected: "开头尽快建立观看理由",
    },
  ])(
    "passes the $purpose sub-intent into script strategy",
    ({ purpose, expected }) => {
      const line = buildConfirmedIntentLine({
        purpose,
        audience: purpose === "gift" ? "specific_person" : "public",
        platform: purpose === "social_post" ? "unknown" : "presentation",
        tone: "真实、清楚",
      });

      expect(line).toContain(expected);
    }
  );

  it("returns an empty line when no intent is confirmed", () => {
    expect(buildConfirmedIntentLine(null)).toBe("");
    expect(buildConfirmedIntentLine(undefined)).toBe("");
  });
});
