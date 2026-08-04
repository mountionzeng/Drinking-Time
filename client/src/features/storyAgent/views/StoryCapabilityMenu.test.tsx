import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/features/storyAgent/types";
import type { StoryIntent } from "../intentTypes";

vi.stubGlobal("React", React);

const contextState = vi.hoisted(() => ({
  setConfirmedIntent: vi.fn(),
}));

vi.mock("@/features/storyAgent/StoryAgentContext", () => ({
  useStoryAgent: () => contextState,
  useStoryAgentActions: () => contextState,
}));

const openingMessage: ChatMessage = {
  id: "first-question",
  role: "assistant",
  content: "你好，我是聊聊。",
  timestamp: 1,
};

describe("StoryCapabilityMenu", () => {
  it("renders only four top-level labels and the direct-speech escape hatch", async () => {
    const { default: StoryCapabilityMenu } = await import(
      "./StoryCapabilityMenu"
    );

    const html = renderToStaticMarkup(<StoryCapabilityMenu />);

    expect(html.match(/<button/g)).toHaveLength(4);
    expect(html).toContain("给自己讲");
    expect(html).toContain("给别人讲");
    expect(html).toContain("记录再说");
    expect(html).toContain("创造另外一个世界");
    expect(html.indexOf("给自己讲")).toBeLessThan(html.indexOf("给别人讲"));
    expect(html.indexOf("给别人讲")).toBeLessThan(html.indexOf("记录再说"));
    expect(html.indexOf("记录再说")).toBeLessThan(
      html.indexOf("创造另外一个世界")
    );
    expect(html).not.toContain("给自己留念");
    expect(html).not.toContain("父母给孩子讲故事");
    expect(html).not.toContain("生成求职视频");
    expect(html).toContain("直接说你的事");
  });

  it("keeps child labels behind their corresponding top-level label", async () => {
    const { capabilityGroupFor } = await import("./StoryCapabilityMenu");

    expect(capabilityGroupFor("tell_my_story")?.options).toEqual([
      "self_reflection",
    ]);
    expect(capabilityGroupFor("tell_someone")?.options).toEqual([
      "portfolio",
      "gift",
      "social_post",
    ]);
    expect(capabilityGroupFor("keep_a_memory")?.options).toEqual([
      "raw_record",
    ]);
    expect(capabilityGroupFor("create_a_world")?.options).toEqual(["fiction"]);
  });

  it("top-level self, record, and fiction choices immediately confirm distinct intents", async () => {
    const { capabilityGroupFor, chooseCapabilityGroup } = await import(
      "./StoryCapabilityMenu"
    );
    const setConfirmedIntent = vi.fn();
    const openGroup = vi.fn();

    const selfIntent = chooseCapabilityGroup(
      capabilityGroupFor("tell_my_story")!,
      setConfirmedIntent,
      openGroup
    );
    const recordIntent = chooseCapabilityGroup(
      capabilityGroupFor("keep_a_memory")!,
      setConfirmedIntent,
      openGroup
    );
    const fictionIntent = chooseCapabilityGroup(
      capabilityGroupFor("create_a_world")!,
      setConfirmedIntent,
      openGroup
    );

    expect(selfIntent).toMatchObject({
      purpose: "self_reflection",
      audience: "self",
    });
    expect(recordIntent).toMatchObject({
      purpose: "raw_record",
      audience: "self",
    });
    expect(fictionIntent).toMatchObject({ purpose: "fiction" });
    expect(openGroup).not.toHaveBeenCalled();
  });

  it("telling others asks for the specific audience before confirming", async () => {
    const { capabilityGroupFor, chooseCapabilityGroup } = await import(
      "./StoryCapabilityMenu"
    );
    const setConfirmedIntent = vi.fn();
    const openGroup = vi.fn();

    const result = chooseCapabilityGroup(
      capabilityGroupFor("tell_someone")!,
      setConfirmedIntent,
      openGroup
    );

    expect(result).toBeNull();
    expect(setConfirmedIntent).not.toHaveBeenCalled();
    expect(openGroup).toHaveBeenCalledWith("tell_someone");
  });

  it("offers exactly the three requested sub-intents after telling others", async () => {
    const { CAPABILITY_OPTIONS, capabilityGroupFor } = await import(
      "./StoryCapabilityMenu"
    );
    const group = capabilityGroupFor("tell_someone")!;
    const labels = group.options.map(
      id => CAPABILITY_OPTIONS.find(option => option.id === id)?.label
    );

    expect(labels).toEqual(["介绍自己", "给亲友的礼物", "发在社交平台上"]);
    expect(group.options).not.toContain("linkedin_job_search");
  });

  it("selecting job search confirms the shared intent and leaves intake fields empty for U3", async () => {
    const { chooseCapability } = await import("./StoryCapabilityMenu");
    const setConfirmedIntent = vi.fn();

    const intent = chooseCapability("linkedin_job_search", setConfirmedIntent);

    expect(setConfirmedIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "linkedin_job_search",
        audience: "recruiters",
        platform: "linkedin",
      })
    );
    expect(intent.targetRole).toBeUndefined();
    expect(intent.channel).toBeUndefined();
  });

  it("selecting a social post confirms a non-job intent without entering the job lane", async () => {
    const { chooseCapability } = await import("./StoryCapabilityMenu");
    const setConfirmedIntent = vi.fn();

    const intent = chooseCapability("social_post", setConfirmedIntent);

    expect(intent.purpose).toBe("social_post");
    expect(intent.purpose).not.toBe("linkedin_job_search");
    expect(setConfirmedIntent).toHaveBeenCalledWith(intent);
  });

  it("maps the friends-and-family gift lane to a private specific-person story", async () => {
    const { chooseCapability } = await import("./StoryCapabilityMenu");
    const intent = chooseCapability("gift", vi.fn());

    expect(intent).toMatchObject({
      purpose: "gift",
      audience: "specific_person",
      platform: "private_archive",
      desiredEffect: expect.stringContaining("亲友"),
    });
  });

  it("maps self-introduction to a public story about the user", async () => {
    const { chooseCapability } = await import("./StoryCapabilityMenu");
    const intent = chooseCapability("portfolio", vi.fn());

    expect(intent).toMatchObject({
      purpose: "portfolio",
      audience: "public",
      platform: "presentation",
      desiredEffect: expect.stringContaining("我是谁"),
    });
  });

  it("selecting fiction confirms a world-building story intent without entering the job lane", async () => {
    const { chooseCapability } = await import("./StoryCapabilityMenu");
    const setConfirmedIntent = vi.fn();

    const intent = chooseCapability("fiction", setConfirmedIntent);

    expect(setConfirmedIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "fiction",
        audience: "public",
        platform: "presentation",
        desiredEffect: expect.stringContaining("虚构灵感"),
      })
    );
    expect(intent.targetRole).toBeUndefined();
    expect(intent.channel).toBeUndefined();
    expect(intent.jobMaterialsPrompted).toBeUndefined();
  });

  it("hides once an intent already exists", async () => {
    const { shouldShowCapabilityMenu } = await import("./StoryCapabilityMenu");
    const confirmedIntent: StoryIntent = {
      purpose: "personal_memory",
      audience: "self",
      platform: "private_archive",
    };

    expect(
      shouldShowCapabilityMenu({
        messages: [openingMessage],
        confirmedIntent,
        returningGreeting: null,
        isReplying: false,
      })
    ).toBe(false);
  });

  it("does not append chat messages when a menu option is selected", async () => {
    const { chooseCapability } = await import("./StoryCapabilityMenu");
    const messages = [openingMessage];

    chooseCapability("linkedin_job_search", vi.fn());

    expect(messages).toEqual([openingMessage]);
  });

  it("shows for an opening assistant message but not after the user starts talking", async () => {
    const { shouldShowCapabilityMenu } = await import("./StoryCapabilityMenu");

    expect(
      shouldShowCapabilityMenu({
        messages: [openingMessage],
        confirmedIntent: null,
        returningGreeting: null,
        isReplying: false,
      })
    ).toBe(true);

    expect(
      shouldShowCapabilityMenu({
        messages: [
          openingMessage,
          {
            id: "user-1",
            role: "user",
            content: "想做找工作的片子",
            timestamp: 2,
          },
        ],
        confirmedIntent: null,
        returningGreeting: null,
        isReplying: false,
      })
    ).toBe(false);
  });
});
