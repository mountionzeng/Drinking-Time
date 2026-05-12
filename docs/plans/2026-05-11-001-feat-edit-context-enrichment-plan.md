---
title: Add edit context enrichment for Story Agent learning
type: feat
status: active
date: 2026-05-11
origin: docs/brainstorms/2026-05-11-edit-context-enrichment-requirements.md
---

# Add edit context enrichment for Story Agent learning

## Summary

Enable the Story Agent to learn from user edits by capturing state snapshots at generation boundaries, computing diffs to identify what users delete/modify/keep, generating semantic annotations via LLM to infer aesthetic preferences, and injecting structured edit context into the Agent's system prompt. This makes the Agent adapt its generation style based on behavioral signals rather than only conversation history.

---

## Problem Frame

Currently, the DROP ZONE Agent generates story cards, scripts, and shots based on user conversation, but has no memory of what users edit afterward. When a user deletes cards about specific themes, rewrites dramatic dialogue to be more restrained, or repeatedly emphasizes bodily sensations, the Agent continues generating in its default style—ignoring these strong behavioral signals. Research shows edits achieve 61.3% accuracy in predicting user preferences vs. 57.7% for stated preferences, yet the system lacks any mechanism to treat edits as meaningful creative direction.

---

## Requirements

- R1. Store project state snapshots at key moments (explicit generation requests + auto-save fallback)
- R2. Compute structured diffs identifying card/script/shot additions, deletions, and modifications
- R3. Generate two-layer semantic annotations (factual changes + inferred preferences) via LLM
- R4. Inject recent annotations into Agent system prompt before each generation
- R5. Never block Agent generation due to annotation failures (graceful degradation)
- R6. Support dual-mode persistence (MySQL and in-memory JSON)
- R7. Maintain snapshot retention policy (keep all for current session, archive after 30 days)
- R8. Provide transparent learning moments where Agent mentions applied preferences
- R9. Track edits across cards, script sections, and shot parameters
- R10. Ignore non-semantic changes (order, metadata, UI state)

**Origin requirements:** R1-R27 from origin document, covering data models (EditSnapshot, SemanticAnnotation tables), snapshot triggers (explicit + auto-save), diff algorithms, annotation generation, prompt injection, and transparency strategy.

---

## Scope Boundaries

- Story-driven path only (StoryCardsBoard, ScriptViewer, ShotTable)
- Project-level edit tracking (no cross-project aesthetic fingerprinting)
- Synchronous annotation with graceful fallback
- No user-facing edit history UI
- No undo/redo functionality in this phase

### Deferred to Follow-Up Work

- Material-driven path edit tracking (DropZone, TemplateDraft): separate workflow, different feature
- Cross-project aesthetic profiles: Phase 2 after validating project-level approach
- Fine-grained conversation edit tracking: handled via existing conversation history
- User-facing timeline view: not needed for semi-transparent approach
- Real-time collaborative editing: multi-user not in current scope

---

## Context & Research

### Relevant Code and Patterns

- `server/routers.ts` (line 443): tRPC router with `storyAgent.chat` endpoint—new endpoints follow this pattern
- `server/archive/storyAgent.ts` (line 547): `replyFromStoryAgent()`, `buildAgentSystemPrompt()`—prompt injection integrates here
- `client/src/features/storyAgent/StoryAgentContext.tsx`: state management with `sendMessage()`, localStorage persistence—snapshot capture hooks in here
- `client/src/features/storyAgent/types.ts`: `StoryCard`, `GeneratedScript`, `StoryShot` interfaces define snapshot state shape
- `server/db.ts`: dual-mode persistence (MySQL via Drizzle when `DATABASE_URL` set, in-memory JSON otherwise)
- `server/_core/llm.ts` (line 283): `invokeLLM()` function supports structured output—reuse for annotation calls

### Institutional Learnings

- No existing snapshot/diff/annotation mechanisms—this is greenfield work
- Drizzle ORM schema lives in `server/db.ts`; new tables add there
- LLM client supports structured JSON response format via `response_format` parameter
- System prompt construction in `buildAgentSystemPrompt()` is the injection point

### External References

- **jsondiffpatch**: Recursive tree diff with object-hash for stable array identity—use pattern for TypeScript implementation
- **CIPHER/PRELUDE** (Microsoft Research, NeurIPS 2024): LLM-based preference inference from edit pairs—compare generated vs. edited output, aggregate across contexts
- **Event sourcing + periodic snapshots** (Martin Fowler): Store immutable events, take full-state snapshots every N events for performance
- Key pitfall: over-interpreting single edits—require 2-3 consistent signals before promoting to active preference
- Batch preference inference on explicit triggers, not keystrokes

---

## Key Technical Decisions

- **Diff algorithm**: Implement jsondiffpatch pattern in TypeScript server-side with `objectHash` functions for StoryCard (by id), ScriptScene (by id), ShotRow (by shotNo). Ignore volatile metadata via property filters.
- **Annotation model**: Use project's default LLM (gemini-2.5-flash) via existing `invokeLLM()` with structured output. CIPHER-inspired two-layer prompt: factual changes + inferred preferences as JSON arrays.
- **Synchronous flow with fallback**: Annotation runs synchronously (30s timeout) for immediate feedback. On failure, store raw diff and inject as fallback context. Circuit breaker after 3 consecutive failures skips annotation for 10 minutes.
- **Snapshot triggers**: Primary = explicit user generation request (before Agent call). Fallback = 5-minute auto-save when edits detected. Auto-save skips annotation generation.
- **Recency window**: Inject most recent 5 annotations (configurable constant). Token budget cap at 1000 tokens—truncate if exceeded.
- **Dual-mode persistence**: EditSnapshot and SemanticAnnotation tables support both MySQL (via Drizzle) and in-memory JSON (`.webdev/local-persist.json` backup).

---

## Open Questions

### Resolved During Planning

- **Which LLM model for annotation?** → Use gemini-2.5-flash (project default) for consistency and cost-effectiveness
- **Synchronous vs async annotation?** → Synchronous with 30s timeout and circuit breaker for acceptable latency
- **Recency window size?** → Start with 5 annotations based on research showing multi-context aggregation improves accuracy
- **Where to hook snapshot capture?** → After state update in `sendMessage()`, before tRPC call to agent

### Deferred to Implementation

- Exact token counts for annotation prompt and response—measure during first implementation
- Optimal circuit breaker threshold (currently 3 failures)—tune based on real failure patterns
- Auto-save interval (currently 5 minutes)—adjust based on user editing patterns
- Annotation confidence scoring—add if needed after observing inference quality

---

## Implementation Units

### U1. Database schema and dual-mode persistence

**Goal:** Add EditSnapshot and SemanticAnnotation tables to Drizzle schema supporting both MySQL and in-memory modes.

**Requirements:** R1, R6, R7

**Dependencies:** None

**Files:**
- Modify: `server/db.ts`
- Test: `server/db.test.ts` (create)

**Approach:**
- Define `editSnapshots` table: id (uuid), projectId, sessionId, timestamp, state (JSON), previousSnapshotId (nullable)
- Define `semanticAnnotations` table: id (uuid), snapshotId, previousSnapshotId, factualChanges (JSON array), inferredPreferences (JSON array), timestamp, status (enum: success/fallback)
- Follow existing dual-mode pattern in `server/db.ts`—tables work with both Drizzle MySQL and in-memory store
- State JSON structure: `{ cards: StoryCard[], script: GeneratedScript | null, shots: StoryShot[] }`
- Add indexes: projectId + timestamp for efficient recent-snapshot queries

**Patterns to follow:**
- Existing table definitions in `server/db.ts` for dual-mode support
- JSON column pattern used in `stories` table for flexible state storage

**Test scenarios:**
- Happy path: Create snapshot with valid state JSON, retrieve by projectId
- Happy path: Create annotation linked to snapshot pair, retrieve recent annotations
- Edge case: First snapshot (previousSnapshotId = null)
- Edge case: Query snapshots for project with no snapshots (returns empty array)
- Integration: Verify both MySQL and in-memory modes store and retrieve correctly
- Edge case: State JSON with only cards (script and shots null/empty)

**Verification:**
- Tables created in both MySQL and in-memory modes
- Can insert and query snapshots and annotations
- Foreign key relationships enforced (annotation → snapshot)
- JSON columns accept valid state structures

---

### U2. Diff computation service

**Goal:** Implement server-side diff algorithm that detects additions, deletions, and modifications across cards, script, and shots while ignoring metadata changes.

**Requirements:** R2, R9, R10

**Dependencies:** U1

**Files:**
- Create: `server/_core/editDiff.ts`
- Create: `server/_core/editDiff.test.ts`

**Approach:**
- Implement recursive diff following jsondiffpatch pattern
- Define `objectHash` functions: `(card) => card.id`, `(scene) => scene.id`, `(shot) => shot.shotNo`
- Property filters to ignore: `createdAt`, `updatedAt`, `timestamp`, any UI-only fields
- Output structure:
  ```typescript
  interface EditDiff {
    cards: {
      deleted: StoryCard[];
      added: StoryCard[];
      modified: Array<{ old: StoryCard; new: StoryCard }>;
    };
    script: {
      modified: Array<{ section: string; oldContent: string; newContent: string }>;
    };
    shots: {
      deleted: ShotRow[];
      added: ShotRow[];
      modified: Array<{ old: ShotRow; new: ShotRow }>;
    };
  }
  ```
- For script diffs, detect scene-level changes (added/removed scenes, dialogue modifications)
- For shot diffs, track parameter changes (shotType, cameraAngle, etc.) but ignore readiness scores

**Patterns to follow:**
- jsondiffpatch recursive tree diff with stable identity
- Existing type definitions in `client/src/features/storyAgent/types.ts`

**Test scenarios:**
- Happy path: Detect card deletion (card in old, not in new)
- Happy path: Detect card addition (card in new, not in old)
- Happy path: Detect card modification (same id, different content)
- Edge case: Empty diff (identical states)
- Edge case: First snapshot (old state is null, all items marked as added)
- Edge case: Reordered cards with same content (should produce empty diff)
- Edge case: Only metadata changed (createdAt updated, should produce empty diff)
- Integration: Diff with cards, script, and shots all modified simultaneously
- Edge case: Very large diff (50+ cards deleted)

**Verification:**
- Diff correctly identifies all three change types (add/delete/modify)
- Metadata-only changes produce empty diffs
- Reordering without content changes produces empty diffs
- Output structure matches EditDiff interface

---

### U3. Snapshot capture in frontend

**Goal:** Hook into StoryAgentContext to capture current state and trigger snapshot save before each Agent generation request.

**Requirements:** R1, R4

**Dependencies:** U1, U4

**Files:**
- Modify: `client/src/features/storyAgent/StoryAgentContext.tsx`
- Test: `client/src/features/storyAgent/StoryAgentContext.test.tsx` (create or extend)

**Approach:**
- Add `captureSnapshot()` function in StoryAgentContext
- Call before `sendMessage()` triggers tRPC mutation
- Gather current state: `{ cards, script, shots }` from context
- Call `trpc.editContext.saveSnapshot.mutate({ projectId, sessionId, state })`
- Store returned snapshotId in context for reference
- Handle errors silently (log but don't block message send)

**Patterns to follow:**
- Existing `sendMessage()` flow in StoryAgentContext
- tRPC mutation pattern used for `storyAgent.chat`
- Error handling pattern: log and continue

**Test scenarios:**
- Happy path: User sends message, snapshot captured with current cards/script/shots
- Edge case: First message (no previous snapshot)
- Edge case: Message sent with empty state (no cards, no script, no shots)
- Error path: Snapshot save fails (network error), message send proceeds anyway
- Integration: Snapshot captured, then message sent, then Agent responds

**Verification:**
- Snapshot captured before every message send
- Current state correctly serialized
- Message send never blocked by snapshot failure
- SnapshotId stored in context after successful capture

---

### U4. Snapshot storage and retrieval endpoints

**Goal:** Create tRPC endpoints for saving snapshots, computing diffs, and retrieving recent annotations.

**Requirements:** R1, R2, R4

**Dependencies:** U1, U2

**Files:**
- Modify: `server/routers.ts`
- Create: `server/services/editContext.ts`
- Test: `server/services/editContext.test.ts`

**Approach:**
- Add `editContext` router to tRPC with procedures:
  - `saveSnapshot`: accepts projectId, sessionId, state; computes diff from previous; stores snapshot; returns snapshotId
  - `getRecentAnnotations`: accepts projectId, limit (default 5); returns recent annotations ordered by timestamp desc
- Implement `editContext.ts` service:
  - `saveSnapshot()`: query previous snapshot, call diff service, insert new snapshot
  - `getRecentAnnotations()`: query annotations table with projectId filter and limit
- Handle first snapshot case (previousSnapshotId = null, skip diff)
- Return empty diff when no changes detected

**Patterns to follow:**
- Existing tRPC router structure in `server/routers.ts`
- Service layer pattern for business logic
- Dual-mode persistence via `server/db.ts`

**Test scenarios:**
- Happy path: Save first snapshot (no previous), returns snapshotId
- Happy path: Save second snapshot, diff computed against first
- Happy path: Retrieve recent annotations (returns up to 5)
- Edge case: Save snapshot with identical state (empty diff)
- Edge case: Retrieve annotations for project with none (returns empty array)
- Integration: Save snapshot → compute diff → store annotation → retrieve annotations
- Error path: Database write fails, returns error without crashing

**Verification:**
- Snapshots stored with correct projectId and timestamp
- Diffs computed and linked to snapshot pairs
- Recent annotations retrieved in correct order (newest first)
- Empty diffs handled gracefully

---

### U5. Semantic annotation service

**Goal:** Generate two-layer semantic annotations (factual changes + inferred preferences) via LLM with structured output, falling back to raw diff on failure.

**Requirements:** R3, R5

**Dependencies:** U2, U4

**Files:**
- Create: `server/services/semanticAnnotation.ts`
- Create: `server/services/semanticAnnotation.test.ts`

**Approach:**
- Implement `generateAnnotation(diff: EditDiff, previousAnnotations: SemanticAnnotation[]): Promise<SemanticAnnotation>`
- Build LLM prompt:
  - System: "You are a creative analysis assistant. Analyze user edits to infer aesthetic preferences."
  - User: Structured diff JSON + previous 2-3 annotations for continuity
  - Response format: JSON with `{ factualChanges: string[], inferredPreferences: string[] }`
- Call `invokeLLM()` with `response_format: { type: 'json_object' }`
- Parse and validate response structure
- On success: return annotation with status='success'
- On failure (timeout, malformed JSON, LLM error): return annotation with status='fallback', factualChanges=raw diff summary, inferredPreferences=[]
- Timeout: 30 seconds
- Include 2-3 example annotations in prompt for consistency

**Patterns to follow:**
- Existing `invokeLLM()` usage in `server/archive/storyAgent.ts`
- Structured output pattern with `response_format`
- Error handling: log and degrade gracefully

**Test scenarios:**
- Happy path: Valid diff produces two-layer annotation
- Happy path: Annotation includes factual changes like "Deleted 2 cards with emotion: nostalgic"
- Happy path: Annotation includes inferred preferences like "User prefers restrained emotional expression"
- Error path: LLM returns malformed JSON, fallback to raw diff
- Error path: LLM call times out, fallback to raw diff
- Edge case: Empty diff (skip annotation generation, return null)
- Integration: Covers AE1. Annotation generated from card deletion diff

**Verification:**
- Valid annotations have both factualChanges and inferredPreferences arrays
- Fallback annotations have status='fallback' and only factualChanges
- LLM errors never crash the service
- Timeout enforced at 30 seconds

---

### U6. Prompt injection integration

**Goal:** Fetch recent annotations before Agent generation and inject formatted edit context into system prompt.

**Requirements:** R4, R8

**Dependencies:** U4, U5

**Files:**
- Modify: `server/archive/storyAgent.ts` (buildAgentSystemPrompt function)
- Test: `server/archive/storyAgent.test.ts` (create or extend)

**Approach:**
- Before calling `buildAgentSystemPrompt()`, fetch recent 5 annotations via `getRecentAnnotations(projectId, 5)`
- Format annotations as structured text block:
  ```
  === 用户编辑偏好（基于本项目历史） ===

  最近的编辑事实：
  - [factual change 1]
  - [factual change 2]

  推断的创作偏好：
  - [inferred preference 1]
  - [inferred preference 2]

  请在生成新内容时参考这些偏好。
  ===
  ```
- Inject after Agent identity/role definition, before conversation history
- Token budget check: if formatted block exceeds 1000 tokens, truncate to most recent annotations that fit
- If no annotations exist, skip injection (vanilla prompt)
- Add transparency instruction to system prompt: "当你应用了用户的编辑偏好时，可以偶尔提及，但不要每次都说。保持自然对话感。"

**Patterns to follow:**
- Existing `buildAgentSystemPrompt()` structure in `server/archive/storyAgent.ts`
- System prompt composition pattern

**Test scenarios:**
- Happy path: Covers AE1. Annotations injected, Agent avoids deleted themes
- Happy path: Covers AE2. Rewrite pattern annotation injected, Agent uses restrained style
- Happy path: Covers AE3. Agent mentions learned preference in response
- Edge case: No annotations (cold start), vanilla prompt used
- Edge case: Annotations exceed token budget, truncated to fit
- Integration: Fetch annotations → format → inject → Agent generates with context

**Verification:**
- Edit context block appears in system prompt when annotations exist
- Token budget enforced (max 1000 tokens for edit context)
- Vanilla prompt used when no annotations
- Transparency instruction included in system prompt

---

### U7. Auto-save fallback mechanism

**Goal:** Implement 5-minute timer that silently saves snapshots when edits detected, without generating annotations.

**Requirements:** R1

**Dependencies:** U3, U4

**Files:**
- Modify: `client/src/features/storyAgent/StoryAgentContext.tsx`
- Test: `client/src/features/storyAgent/StoryAgentContext.test.tsx`

**Approach:**
- Add useEffect with 5-minute interval timer
- On timer fire, check if state has changed since last snapshot (compare state hash or timestamp)
- If changed, call `trpc.editContext.saveSnapshot.mutate()` with `autoSave: true` flag
- Server skips annotation generation for auto-saved snapshots
- Debounce: wait for 2 seconds of inactivity before auto-saving
- Pause auto-save during active LLM generation (check context state)
- No UI feedback (silent operation)

**Patterns to follow:**
- Existing useEffect patterns in StoryAgentContext for localStorage persistence
- Timer cleanup on unmount

**Test scenarios:**
- Happy path: Covers AE4. User edits, 6 minutes pass, snapshot auto-saved
- Edge case: User edits then sends message before timer (explicit snapshot, timer resets)
- Edge case: No edits since last snapshot (timer fires, no snapshot created)
- Edge case: Auto-save during active generation (paused, resumes after)
- Integration: Auto-save snapshot used for next explicit generation's diff

**Verification:**
- Timer fires every 5 minutes
- Snapshots created only when state changed
- No annotation generated for auto-saved snapshots
- Timer resets after explicit snapshot capture

---

### U8. Error handling and monitoring

**Goal:** Implement circuit breaker for annotation failures, graceful degradation logging, and fallback context injection.

**Requirements:** R5

**Dependencies:** U5, U6

**Files:**
- Modify: `server/services/semanticAnnotation.ts`
- Modify: `server/archive/storyAgent.ts`
- Test: `server/services/semanticAnnotation.test.ts`

**Approach:**
- Add circuit breaker state: track consecutive annotation failures
- After 3 consecutive failures, skip annotation generation for 10 minutes
- Log all annotation failures with context (snapshotId, error message, timestamp) but don't surface to user
- On fallback, inject raw diff summary as edit context:
  ```
  === 用户最近的编辑 ===
  - 删除了 2 张卡片
  - 修改了剧本场景 3 的对话
  ===
  ```
- Monitor fallback rate for debugging (log metric)
- Reset circuit breaker on successful annotation

**Patterns to follow:**
- Error logging pattern in existing services
- Graceful degradation: continue with reduced functionality

**Test scenarios:**
- Happy path: Single annotation failure, fallback used, next attempt succeeds
- Error path: Covers AE5. 3 consecutive failures, circuit breaker opens, annotation skipped
- Error path: Circuit breaker open, 10 minutes pass, next attempt tries annotation again
- Integration: Annotation fails → raw diff injected → Agent generates with fallback context
- Edge case: Circuit breaker state persists across server restarts (use in-memory for now)

**Verification:**
- Circuit breaker opens after 3 failures
- Circuit breaker closes after 10 minutes or successful annotation
- Raw diff injected when annotation unavailable
- Agent generation never blocked by annotation errors

---

## System-Wide Impact

- **Interaction graph**: Snapshot capture hooks into StoryAgentContext.sendMessage() → tRPC mutation → diff computation → annotation generation → prompt injection in buildAgentSystemPrompt()
- **Error propagation**: Annotation failures degrade to raw diff injection; never block Agent generation
- **State lifecycle risks**: Concurrent snapshot captures (rapid message sends) handled by server-side sequencing; auto-save pauses during active generation
- **API surface parity**: New tRPC endpoints (`editContext.saveSnapshot`, `editContext.getRecentAnnotations`) follow existing router patterns
- **Integration coverage**: Test scenario AE6 covers multi-modal diff (card + script + shot changes in single snapshot)
- **Unchanged invariants**: Existing conversation history persistence unchanged; localStorage pattern for StoryAgentContext state unchanged; Agent generation flow unchanged except for prompt injection point

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| LLM annotation quality varies | Two-layer structure provides factual grounding; fallback to raw diff ensures baseline functionality |
| Annotation latency impacts UX | 30s timeout with circuit breaker; synchronous acceptable for founder self-use; can optimize to async in Phase 2 |
| Over-interpreting sparse edits | Require 2-3 consistent signals (research-backed); aggregate across multiple annotations |
| Token budget for edit context | Hard cap at 1000 tokens; truncate to most recent annotations that fit |
| Dual-mode persistence complexity | Follow existing pattern in server/db.ts; test both modes explicitly |
| Snapshot storage growth | Retention policy: archive after 30 days, keep last 50 per project |

---

## Documentation / Operational Notes

- Add section to `docs/drop-zone-agent-training.md` explaining edit context enrichment and how it shapes Agent behavior
- Document annotation prompt template for future tuning
- Log annotation fallback rate for monitoring (target: <10% fallback rate)
- No user-facing documentation needed (semi-transparent feature)

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-05-11-edit-context-enrichment-requirements.md](docs/brainstorms/2026-05-11-edit-context-enrichment-requirements.md)
- Related code: `server/archive/storyAgent.ts`, `client/src/features/storyAgent/StoryAgentContext.tsx`
- External docs:
  - CIPHER/PRELUDE paper: https://arxiv.org/abs/2404.15269
  - jsondiffpatch: https://github.com/benjamine/jsondiffpatch
  - Event sourcing: https://martinfowler.com/eaaDev/EventSourcing.html
