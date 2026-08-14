import { describe, expect, it } from "vitest";
import {
  buildOwnerScope,
  bumpAggregateForProjection,
  commitResourceRevision,
  deriveClientCacheScopeKey,
  hasResourceRevisionConflict,
  parseDomainCommand,
  parseScopeKey,
  scopeKeysEqual,
  type PayloadParseResult,
  type ScopeKey,
} from "./scopedResource";

describe("parseScopeKey — contract", () => {
  it("rejects a candidate missing storyId", () => {
    expect(parseScopeKey({ resourceKind: "story" })).toBeNull();
  });

  it("rejects an unknown resourceKind", () => {
    expect(
      parseScopeKey({ resourceKind: "nope", storyId: 1 })
    ).toBeNull();
  });

  it("rejects publishingVersion missing versionId", () => {
    expect(
      parseScopeKey({ resourceKind: "publishingVersion", storyId: 1 })
    ).toBeNull();
  });

  it("rejects stableShot missing stableShotId", () => {
    expect(
      parseScopeKey({ resourceKind: "stableShot", storyId: 1 })
    ).toBeNull();
  });

  it("rejects cover missing versionId", () => {
    expect(parseScopeKey({ resourceKind: "cover", storyId: 1 })).toBeNull();
  });

  it("rejects a negative or non-integer storyId", () => {
    expect(parseScopeKey({ resourceKind: "story", storyId: -1 })).toBeNull();
    expect(
      parseScopeKey({ resourceKind: "story", storyId: 1.5 })
    ).toBeNull();
  });

  it("parses a valid story scope", () => {
    expect(parseScopeKey({ resourceKind: "story", storyId: 42 })).toEqual({
      resourceKind: "story",
      storyId: 42,
    });
  });

  it("parses a valid publishingVersion scope", () => {
    expect(
      parseScopeKey({
        resourceKind: "publishingVersion",
        storyId: 42,
        versionId: "v2",
      })
    ).toEqual({ resourceKind: "publishingVersion", storyId: 42, versionId: "v2" });
  });

  it("ignores extraneous fields such as a smuggled userId", () => {
    const parsed = parseScopeKey({
      resourceKind: "story",
      storyId: 42,
      userId: 999,
    });
    expect(parsed).toEqual({ resourceKind: "story", storyId: 42 });
    expect(parsed).not.toHaveProperty("userId");
  });

  it("rejects an empty-string versionId", () => {
    expect(
      parseScopeKey({
        resourceKind: "publishingVersion",
        storyId: 1,
        versionId: "   ",
      })
    ).toBeNull();
  });

  it("rejects a storyId supplied as a numeric string", () => {
    expect(
      parseScopeKey({ resourceKind: "story", storyId: "42" })
    ).toBeNull();
  });
});

describe("parseDomainCommand — contract", () => {
  const parsePayload = (raw: unknown): PayloadParseResult<string> =>
    typeof raw === "string" ? { ok: true, value: raw } : { ok: false };

  it("rejects a command missing scope", () => {
    expect(
      parseDomainCommand(
        { expectedResourceRevision: 0, payload: "hi" },
        parsePayload
      )
    ).toBeNull();
  });

  it("rejects a command missing expectedResourceRevision", () => {
    expect(
      parseDomainCommand(
        { scope: { resourceKind: "story", storyId: 1 }, payload: "hi" },
        parsePayload
      )
    ).toBeNull();
  });

  it("rejects a negative expectedResourceRevision", () => {
    expect(
      parseDomainCommand(
        {
          scope: { resourceKind: "story", storyId: 1 },
          expectedResourceRevision: -1,
          payload: "hi",
        },
        parsePayload
      )
    ).toBeNull();
  });

  it("rejects a command whose payload fails the injected parser", () => {
    expect(
      parseDomainCommand(
        {
          scope: { resourceKind: "story", storyId: 1 },
          expectedResourceRevision: 0,
          payload: 12345,
        },
        parsePayload
      )
    ).toBeNull();
  });

  it("parses a fully valid command", () => {
    const command = parseDomainCommand(
      {
        scope: { resourceKind: "story", storyId: 1 },
        expectedResourceRevision: 3,
        payload: "next title",
      },
      parsePayload
    );
    expect(command).toEqual({
      scope: { resourceKind: "story", storyId: 1 },
      expectedResourceRevision: 3,
      payload: "next title",
    });
  });

  it("accepts a legitimate null payload value without treating it as a parse failure", () => {
    // A payload parser whose valid domain value can itself be null (e.g. "clear
    // the cover") must be distinguishable from "parsing failed" — that's the
    // whole point of PayloadParseResult over a bare `T | null` return.
    const parseNullablePayload = (
      raw: unknown
    ): PayloadParseResult<string | null> =>
      raw === null || typeof raw === "string"
        ? { ok: true, value: raw }
        : { ok: false };
    const command = parseDomainCommand(
      {
        scope: { resourceKind: "story", storyId: 1 },
        expectedResourceRevision: 0,
        payload: null,
      },
      parseNullablePayload
    );
    expect(command).toEqual({
      scope: { resourceKind: "story", storyId: 1 },
      expectedResourceRevision: 0,
      payload: null,
    });
  });
});

describe("buildOwnerScope — ownership", () => {
  it("takes the owner strictly from sessionOwnerUserId, ignoring any field on scope", () => {
    // The pipeline invariant ("client-forged userId never reaches the owner
    // scope") depends on the caller running parseScopeKey first — see the
    // parseScopeKey "ignores extraneous fields" test above for that half.
    // buildOwnerScope itself does zero filtering; it just reads the
    // sessionOwnerUserId argument and passes `scope` through unchanged. This
    // test documents that pass-through behavior directly, without routing
    // through parseScopeKey first.
    const dirtyScope = {
      resourceKind: "story",
      storyId: 7,
      userId: 999,
    } as unknown as ScopeKey;
    const owned = buildOwnerScope(1, dirtyScope);
    expect(owned.ownerUserId).toBe(1);
    expect(owned.scope).toBe(dirtyScope);
  });

  it("uses the authenticated session id even if the raw client payload smuggled a userId, when scope is parsed first", () => {
    // A malicious/buggy client sends a raw object with an extra userId field
    // hoping it gets used for authorization. parseScopeKey strips it before
    // buildOwnerScope ever sees the scope, and the owner comes only from the
    // session id passed in by the router.
    const rawClientPayload = { resourceKind: "story", storyId: 7, userId: 999 };
    const scope = parseScopeKey(rawClientPayload);
    expect(scope).not.toBeNull();
    const owned = buildOwnerScope(1, scope as ScopeKey);
    expect(owned.ownerUserId).toBe(1);
    expect(owned.scope).not.toHaveProperty("userId");
    expect(owned.scope).toEqual({ resourceKind: "story", storyId: 7 });
  });
});

describe("deriveClientCacheScopeKey — client cache is not authorization", () => {
  it("attaches cacheUserId only for cache partitioning", () => {
    const scope: ScopeKey = { resourceKind: "story", storyId: 7 };
    const cacheScope = deriveClientCacheScopeKey(scope, 5);
    expect(cacheScope).toEqual({ resourceKind: "story", storyId: 7, cacheUserId: 5 });
  });
});

describe("scopeKeysEqual", () => {
  it("treats identical story scopes as equal", () => {
    expect(
      scopeKeysEqual(
        { resourceKind: "story", storyId: 1 },
        { resourceKind: "story", storyId: 1 }
      )
    ).toBe(true);
  });

  it("treats different resourceKind as unequal even with the same storyId", () => {
    expect(
      scopeKeysEqual(
        { resourceKind: "story", storyId: 1 },
        { resourceKind: "publishingVersion", storyId: 1, versionId: "v1" }
      )
    ).toBe(false);
  });

  it("treats different versionId under the same story as unequal", () => {
    expect(
      scopeKeysEqual(
        { resourceKind: "publishingVersion", storyId: 1, versionId: "v1" },
        { resourceKind: "publishingVersion", storyId: 1, versionId: "v2" }
      )
    ).toBe(false);
  });

  it("treats different storyId as unequal even with the same stableShotId", () => {
    expect(
      scopeKeysEqual(
        { resourceKind: "stableShot", storyId: 1, stableShotId: "s1" },
        { resourceKind: "stableShot", storyId: 2, stableShotId: "s1" }
      )
    ).toBe(false);
  });

  it("treats identical cover scopes as equal", () => {
    expect(
      scopeKeysEqual(
        { resourceKind: "cover", storyId: 1, versionId: "v1" },
        { resourceKind: "cover", storyId: 1, versionId: "v1" }
      )
    ).toBe(true);
  });

  it("treats a cover and a publishingVersion sharing the same storyId+versionId as unequal", () => {
    // Same storyId and versionId, different resourceKind — must not collide
    // just because their non-discriminant fields happen to match.
    expect(
      scopeKeysEqual(
        { resourceKind: "cover", storyId: 1, versionId: "v1" },
        { resourceKind: "publishingVersion", storyId: 1, versionId: "v1" }
      )
    ).toBe(false);
  });
});

describe("revision transitions — resource vs aggregate", () => {
  it("commitResourceRevision increments both resource and aggregate", () => {
    expect(
      commitResourceRevision({ resourceRevision: 3, aggregateRevision: 9 })
    ).toEqual({ resourceRevision: 4, aggregateRevision: 10 });
  });

  it("bumpAggregateForProjection increments only aggregate", () => {
    expect(
      bumpAggregateForProjection({ resourceRevision: 3, aggregateRevision: 9 })
    ).toEqual({ resourceRevision: 3, aggregateRevision: 10 });
  });

  it("flags a resource revision mismatch as a conflict", () => {
    expect(
      hasResourceRevisionConflict(2, { resourceRevision: 3, aggregateRevision: 9 })
    ).toBe(true);
  });

  it("does not flag a conflict when the resource revision matches", () => {
    expect(
      hasResourceRevisionConflict(3, { resourceRevision: 3, aggregateRevision: 9 })
    ).toBe(false);
  });

  it("does not treat an aggregate-only bump as a conflict for the unaffected resource", () => {
    // Resource B's revision command should be judged only against its own
    // resourceRevision, even after an unrelated aggregate-only bump.
    const beforeUnrelatedWrite = { resourceRevision: 5, aggregateRevision: 20 };
    const afterUnrelatedAggregateBump = bumpAggregateForProjection(
      beforeUnrelatedWrite
    );
    expect(
      hasResourceRevisionConflict(5, afterUnrelatedAggregateBump)
    ).toBe(false);
  });
});
