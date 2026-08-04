import {
  ArrowLeft,
  Briefcase,
  Heart,
  MessageCircleHeart,
  Share2,
  Sparkles,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { useStoryAgentActions } from "@/features/storyAgent/StoryAgentContext";
import type { ChatMessage } from "@/features/storyAgent/types";
import { PURPOSE_LABELS, type StoryIntent } from "../intentTypes";

export type StoryCapabilityId =
  | "self_reflection"
  | "raw_record"
  | "personal_memory"
  | "social_post"
  | "linkedin_job_search"
  | "gift"
  | "portfolio"
  | "fiction";

export const CAPABILITY_OPTIONS: Array<{
  id: StoryCapabilityId;
  label: string;
  description: string;
  icon: typeof Heart;
}> = [
  {
    id: "self_reflection",
    label: "梳理自己的故事",
    description: "从经历里看清自己的选择和变化",
    icon: UserRound,
  },
  {
    id: "raw_record",
    label: "先把它记下来",
    description: "保留原话和细节，暂时不急着讲完整",
    icon: Heart,
  },
  {
    id: "personal_memory",
    label: PURPOSE_LABELS.personal_memory,
    description: "把这一段认真收好",
    icon: Heart,
  },
  {
    id: "social_post",
    label: "发在社交平台上",
    description: "把故事整理成适合公开分享的表达",
    icon: Share2,
  },
  {
    id: "linkedin_job_search",
    label: "生成求职视频",
    description: "突出职业能力与可信度",
    icon: Briefcase,
  },
  {
    id: "gift",
    label: "给亲友的礼物",
    description: "为一个在意的人讲一段专属故事",
    icon: MessageCircleHeart,
  },
  {
    id: "portfolio",
    label: "介绍自己",
    description: "让别人通过真实经历认识你",
    icon: UserRound,
  },
  {
    id: "fiction",
    label: "创造另一个世界",
    description: "一句话生成虚构短片故事",
    icon: Sparkles,
  },
];

export type StoryCapabilityGroupId =
  | "keep_a_memory"
  | "tell_someone"
  | "tell_my_story"
  | "create_a_world";

export const CAPABILITY_GROUPS: Array<{
  id: StoryCapabilityGroupId;
  label: string;
  description: string;
  icon: typeof Heart;
  options: StoryCapabilityId[];
}> = [
  {
    id: "tell_my_story",
    label: "给自己讲",
    description: "把经历、能力和选择讲清楚",
    icon: UserRound,
    options: ["self_reflection"],
  },
  {
    id: "tell_someone",
    label: "给别人讲",
    description: "讲给一个人，或分享给更多人",
    icon: MessageCircleHeart,
    options: ["portfolio", "gift", "social_post"],
  },
  {
    id: "keep_a_memory",
    label: "记录再说",
    description: "先把这段真实经历认真收好",
    icon: Heart,
    options: ["raw_record"],
  },
  {
    id: "create_a_world",
    label: "创造另外一个世界",
    description: "从虚构灵感开始创造",
    icon: Sparkles,
    options: ["fiction"],
  },
];

export function capabilityGroupFor(groupId: StoryCapabilityGroupId) {
  return CAPABILITY_GROUPS.find(group => group.id === groupId) ?? null;
}

export function buildCapabilityIntent(
  capabilityId: StoryCapabilityId
): StoryIntent {
  switch (capabilityId) {
    case "self_reflection":
      return {
        purpose: "self_reflection",
        audience: "self",
        platform: "private_archive",
        desiredEffect: "把零散经历讲成一条自己能够理解的内在线索",
        tone: "坦诚、细腻，允许矛盾和未完成",
        confidence: 1,
        missingQuestion: "",
        configured: true,
      };
    case "raw_record":
      return {
        purpose: "raw_record",
        audience: "self",
        platform: "private_archive",
        desiredEffect: "先保存事实、原话、动作和感受，不急着补成完整故事",
        tone: "克制、纪实、保留原貌",
        confidence: 1,
        missingQuestion: "",
        configured: true,
      };
    case "linkedin_job_search":
      return {
        purpose: "linkedin_job_search",
        audience: "recruiters",
        platform: "linkedin",
        desiredEffect: "让招聘者快速看见这个人的能力、判断力和可信度",
        tone: "清晰、专业、有个人温度，但不过度私人化",
        confidence: 1,
        missingQuestion: "",
        configured: true,
      };
    case "social_post":
      return {
        purpose: "social_post",
        audience: "public",
        platform: "unknown",
        desiredEffect: "让社交平台上的观众快速理解，并愿意看完和回应",
        tone: "自然、清楚、有分享感，适合公开传播",
        confidence: 1,
        missingQuestion: "",
        configured: true,
      };
    case "gift":
      return {
        purpose: "gift",
        audience: "specific_person",
        platform: "private_archive",
        desiredEffect: "让一位亲友感受到这段故事是专门为他或她准备的",
        tone: "亲切、真诚、有私人细节，不过度煽情",
        confidence: 1,
        missingQuestion: "",
        configured: true,
      };
    case "portfolio":
      return {
        purpose: "portfolio",
        audience: "public",
        platform: "presentation",
        desiredEffect: "让别人通过真实经历理解我是谁、在意什么、做过什么",
        tone: "真实、清楚、有个人视角，不像履历朗读",
        confidence: 1,
        missingQuestion: "",
        configured: true,
      };
    case "fiction":
      return {
        purpose: "fiction",
        audience: "public",
        platform: "presentation",
        desiredEffect: "把一句虚构灵感发展成一个能拍的短片故事",
        tone: "有世界感、有人物动机、带一点电影气质",
        confidence: 1,
        missingQuestion: "",
        configured: true,
      };
    case "personal_memory":
    default:
      return {
        purpose: "personal_memory",
        audience: "self",
        platform: "private_archive",
        desiredEffect: "把这段经历保存成给自己回看的短片",
        tone: "私人、柔和、忠于感受",
        confidence: 1,
        missingQuestion: "",
        configured: true,
      };
  }
}

export function chooseCapability(
  capabilityId: StoryCapabilityId,
  setConfirmedIntent: (intent: StoryIntent) => void
): StoryIntent {
  const intent = buildCapabilityIntent(capabilityId);
  setConfirmedIntent(intent);
  return intent;
}

export function chooseCapabilityGroup(
  group: (typeof CAPABILITY_GROUPS)[number],
  setConfirmedIntent: (intent: StoryIntent) => void,
  openGroup: (groupId: StoryCapabilityGroupId) => void
) {
  if (group.options.length === 1) {
    return chooseCapability(group.options[0], setConfirmedIntent);
  }
  openGroup(group.id);
  return null;
}

export function shouldShowCapabilityMenu({
  messages,
  confirmedIntent,
  returningGreeting,
  isReplying,
}: {
  messages: ChatMessage[];
  confirmedIntent: StoryIntent | null;
  returningGreeting: string | null;
  isReplying: boolean;
}): boolean {
  const hasUserMessage = messages.some(
    message =>
      message.role === "user" && (message.content.trim() || message.photoUrl)
  );
  return (
    !confirmedIntent && !returningGreeting && !isReplying && !hasUserMessage
  );
}

export default function StoryCapabilityMenu() {
  const { setConfirmedIntent } = useStoryAgentActions();
  const [selectedGroupId, setSelectedGroupId] =
    useState<StoryCapabilityGroupId | null>(null);
  const selectedGroup = selectedGroupId
    ? capabilityGroupFor(selectedGroupId)
    : null;
  const childOptions = selectedGroup
    ? selectedGroup.options
        .map(capabilityId =>
          CAPABILITY_OPTIONS.find(option => option.id === capabilityId)
        )
        .filter((option): option is (typeof CAPABILITY_OPTIONS)[number] =>
          Boolean(option)
        )
    : [];

  return (
    <div className="flex justify-start" data-testid="story-capability-menu">
      <div
        className="w-full overflow-hidden rounded-xl border text-[12.5px] leading-relaxed"
        style={{
          background: "var(--card)",
          borderColor: "var(--nayin-accent-dim)",
          color: "var(--foreground)",
        }}
      >
        <header
          className="border-b px-3 py-2"
          style={{
            borderColor: "var(--panel-border)",
            background: "var(--nayin-glow)",
          }}
        >
          <div className="flex items-center gap-2 text-[9px] font-mono uppercase tracking-[0.18em] text-nayin-bright">
            {selectedGroup ? (
              <button
                type="button"
                onClick={() => setSelectedGroupId(null)}
                className="inline-flex items-center gap-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nayin-accent)]"
              >
                <ArrowLeft className="h-3 w-3" />
                返回
              </button>
            ) : null}
            <span>{selectedGroup ? "聊聊 · 再选一个" : "新故事 · 第一步"}</span>
          </div>
          <h2 className="mt-1 text-[14px] font-semibold tracking-tight text-foreground">
            {selectedGroup ? selectedGroup.label : "你想从哪一种故事开始？"}
          </h2>
          <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
            {selectedGroup
              ? "聊聊想再确认一下，你更接近下面哪一种？"
              : "先选一个大方向，聊聊会接着问。"}
          </p>
        </header>
        {selectedGroup ? (
          <div className="bg-border/60">
            <div className="bg-card px-3 py-2.5 text-[10.5px] leading-relaxed text-muted-foreground">
              好，我们从“{selectedGroup.label}”开始。选一个更具体的方向：
            </div>
            <div className="grid gap-px">
              {childOptions.map(option => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() =>
                      chooseCapability(option.id, setConfirmedIntent)
                    }
                    className="group flex min-h-[54px] items-center gap-2.5 bg-card px-3 py-2 text-left transition-[background-color,transform] duration-150 hover:bg-[var(--nayin-glow)] focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--nayin-accent)] active:scale-[0.99]"
                  >
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                      style={{ background: "var(--nayin-glow)" }}
                    >
                      <Icon className="h-3.5 w-3.5 text-nayin-bright" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[11px] font-semibold text-foreground">
                        {option.label}
                      </span>
                      <span className="mt-0.5 block text-[9px] text-muted-foreground">
                        {option.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-px bg-border/60">
            {CAPABILITY_GROUPS.map(group => {
              const Icon = group.icon;
              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() =>
                    chooseCapabilityGroup(
                      group,
                      setConfirmedIntent,
                      setSelectedGroupId
                    )
                  }
                  className="group flex min-h-[64px] items-center gap-2.5 bg-card px-3 py-2 text-left transition-[background-color,transform] duration-150 hover:bg-[var(--nayin-glow)] focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--nayin-accent)] active:scale-[0.985]"
                  aria-description={group.description}
                >
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                    style={{ background: "var(--nayin-glow)" }}
                  >
                    <Icon className="h-3.5 w-3.5 text-nayin-bright" />
                  </span>
                  <span className="text-[11px] font-semibold leading-tight text-foreground">
                    {group.label}
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <footer className="px-3 py-1.5 text-[9.5px] text-muted-foreground">
          不想选？直接说你的事也可以，聊聊会自己判断。
        </footer>
      </div>
    </div>
  );
}
