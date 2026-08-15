import { describe, expect, it } from "vitest";

import {
  acceptIntentProposal,
  createIntentProposal,
  migrateLegacyStoryIntent,
  normalizeIntentProposal,
  rejectIntentProposal,
  resolveStoryIntentProfile,
  supersedeIntentProposal,
  storyIntentScopeRevision,
  type StoryIntentProfile,
} from "./storyIntentProfile";

const NOW = 1_786_600_000_000;

function profile(
  primaryPurpose: StoryIntentProfile["primaryPurpose"],
  coreAudience: string,
  revision = 1
): StoryIntentProfile {
  return {
    primaryPurpose,
    secondaryPurposes: [],
    coreAudience,
    secondaryAudiences: [],
    channel: "xiaohongshu",
    expression: { tone: "克制", desiredEffect: "说清楚" },
    status: "confirmed",
    revision,
    provenance: { source: "user", updatedAt: NOW },
  };
}

describe("story intent authority", () => {
  it("derives different scope revisions when revision-less audience or channel changes", () => {
    const base = { purpose: "social_post", audience: "self", platform: "private_archive", desiredEffect: "留给自己" };
    const audienceChanged = { ...base, audience: "public" };
    const channelChanged = { ...base, platform: "xiaohongshu" };
    expect(storyIntentScopeRevision(base)).not.toBe(storyIntentScopeRevision(audienceChanged));
    expect(storyIntentScopeRevision(base)).not.toBe(storyIntentScopeRevision(channelChanged));
  });
  it("uses an active version snapshot after V1 and pre-version profile before V1", () => {
    const preVersion = profile("preserve", "自己");
    const activeVersion = profile("share", "陌生读者", 2);

    expect(resolveStoryIntentProfile({ preVersionProfile: preVersion })).toEqual({
      profile: preVersion,
      authority: "pre_version",
    });
    expect(
      resolveStoryIntentProfile({
        preVersionProfile: preVersion,
        activeVersionSnapshot: activeVersion,
      })
    ).toEqual({ profile: activeVersion, authority: "active_version" });
  });

  it("keeps the active version authoritative and exposes conflicting legacy sources as proposals", () => {
    const migrated = migrateLegacyStoryIntent({
      activeVersionSnapshot: profile("persuade", "产品团队", 5),
      preVersionProfile: profile("preserve", "自己", 4),
      confirmedIntent: {
        purpose: "social_post",
        audience: "public",
        platform: "x",
        status: "confirmed",
      },
      openingIntent: {
        purpose: "gift",
        audience: "specific_person",
        platform: "private_archive",
      },
      storyId: 12,
      activeVersionId: "v3",
      now: NOW,
    });

    expect(migrated.profile).toMatchObject({
      primaryPurpose: "persuade",
      coreAudience: "产品团队",
      revision: 5,
    });
    expect(migrated.proposals).toHaveLength(3);
    expect(migrated.proposals.every(item => item.status === "pending")).toBe(true);
    expect(migrated.proposals.map(item => item.source.kind)).toEqual([
      "legacy_pre_version",
      "legacy_confirmed_intent",
      "legacy_opening_intent",
    ]);
  });
});

describe("intent proposal lifecycle", () => {
  it("rejects malformed persisted proposal lifecycle records", () => {
    const valid = {
      id: "recognition-1",
      source: {
        kind: "recognition",
        storyId: 12,
        versionId: "v1",
        intentRevision: 7,
      },
      changes: { coreAudience: "陌生读者" },
      evidence: ["用户提到公开发布"],
      status: "rejected",
      createdAt: NOW,
      resolvedAt: NOW + 1,
    };
    expect(normalizeIntentProposal(valid)).toEqual(valid);
    expect(
      normalizeIntentProposal({ ...valid, evidence: ["ok", 1] })
    ).toBeNull();
    expect(
      normalizeIntentProposal({ ...valid, changes: { unknown: true } })
    ).toBeNull();
    expect(
      normalizeIntentProposal({ ...valid, createdAt: "yesterday" })
    ).toBeNull();
  });

  it("never reactivates rejected, superseded, duplicate, old-revision, or late-scope proposals", () => {
    const current = profile("preserve", "自己", 7);
    const proposal = createIntentProposal({
      id: "recognition-1",
      currentProfile: current,
      candidate: profile("share", "陌生读者", 8),
      source: { kind: "recognition", storyId: 12, versionId: "v1", intentRevision: 7 },
      evidence: ["用户提到公开发布"],
      now: NOW,
    });
    expect(proposal?.status).toBe("pending");
    expect(createIntentProposal({
      id: "recognition-1",
      currentProfile: current,
      candidate: profile("share", "陌生读者", 8),
      source: proposal!.source,
      existing: [rejectIntentProposal(proposal!, NOW + 1)],
      now: NOW + 2,
    })).toBeNull();
    expect(acceptIntentProposal(rejectIntentProposal(proposal!, NOW + 1), {
      storyId: 12,
      versionId: "v1",
      intentRevision: 7,
    }, NOW + 2)).toBeNull();
    expect(acceptIntentProposal(proposal!, {
      storyId: 13,
      versionId: "v1",
      intentRevision: 7,
    }, NOW + 2)).toBeNull();
    expect(acceptIntentProposal(proposal!, {
      storyId: 12,
      versionId: "v1",
      intentRevision: 8,
    }, NOW + 2)).toBeNull();
    expect(supersedeIntentProposal(proposal!, NOW + 2).status).toBe("superseded");
  });

  it("returns a version transition when a V1+ purpose/audience proposal is accepted", () => {
    const current = profile("preserve", "自己", 2);
    const proposal = createIntentProposal({
      id: "recognition-2",
      currentProfile: current,
      candidate: profile("share", "陌生读者", 3),
      source: { kind: "recognition", storyId: 12, versionId: "v1", intentRevision: 2 },
      now: NOW,
    })!;

    expect(acceptIntentProposal(proposal, {
      storyId: 12,
      versionId: "v1",
      intentRevision: 2,
    }, NOW + 1)).toMatchObject({
      proposal: { status: "accepted" },
      action: "version_transition",
      nextProfile: { primaryPurpose: "share", coreAudience: "陌生读者" },
    });
  });

  it("creates a version for desired-effect changes but not tone-only or channel-only changes", () => {
    const current = profile("share", "陌生读者", 2);
    const scope = { kind: "recognition" as const, storyId: 12, versionId: "v1", intentRevision: 2 };
    const expression = createIntentProposal({ id: "expression", currentProfile: current,
      candidate: { ...current, expression: { ...current.expression, desiredEffect: "让人采取行动" } }, source: scope })!;
    const channel = createIntentProposal({ id: "channel", currentProfile: current,
      candidate: { ...current, channel: "x" }, source: scope })!;
    const tone = createIntentProposal({ id: "tone", currentProfile: current,
      candidate: { ...current, expression: { ...current.expression, tone: "更轻松" } }, source: scope })!;
    const currentScope = { storyId: 12, versionId: "v1", intentRevision: 2 };
    expect(acceptIntentProposal(expression, currentScope)?.action).toBe("version_transition");
    expect(acceptIntentProposal(channel, currentScope)?.action).toBe("profile_update");
    expect(acceptIntentProposal(tone, currentScope)?.action).toBe("profile_update");
  });
});
