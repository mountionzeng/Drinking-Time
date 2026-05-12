---
date: 2026-05-11
topic: edit-context-enrichment
focus: Story Agent multi-modal edit context as prompt enrichment
mode: repo-grounded
---

# Edit Context Enrichment — Multi-Modal Edit History as Agent Prompt Input

## Summary

Enable the Story Agent to learn from user edits within a project session by capturing edit snapshots, generating semantic annotations via LLM, and injecting structured edit context into the Agent's system prompt. This allows the Agent to adapt its generation style based on what users delete, rewrite, or emphasize — making the Agent feel "understood" rather than "monitored."

**Scope**: Project-level edit tracking for the story-driven path only. Cross-project aesthetic fingerprinting is deferred to Phase 2.

---

## Problem Frame

Currently, the DROP ZONE Agent generates story cards, scripts, and shots based on user conversation, but it has no memory of what users edit afterward. When a user deletes cards about a specific character, rewrites dramatic dialogue to be more restrained, or repeatedly emphasizes bodily sensations, the Agent continues generating in its default style — ignoring these strong behavioral signals.

From the ideation memo:
> "Agent only references the original chat transcript, ignoring what users kept, deleted, rewrote, or emphasized."

This creates a frustrating loop: users edit → Agent regenerates similar content → users edit again. The system lacks a mechanism to treat edits as meaningful creative direction.

Research context (2026 behavioral weighting study): edits achieve 61.3% accuracy in predicting user preferences vs. 57.7% for stated preferences. Behavioral signals are stronger than explicit statements.

---

## Users

Film visual development creators using Drinking Time's story-driven workflow (StoryAgentChat → StoryCardsBoard → Script/Shots). Current stage: founder self-use + prototype validation.

**User mental model**: "The Agent should feel like a creative partner who notices my choices and adapts, not a tool that keeps making the same mistakes."

---

## Success Criteria

1. **Agent adaptation is observable**: After a user deletes 2-3 cards with similar themes, the Agent's next generation avoids that theme without being explicitly told.
2. **Transparency at key moments**: The Agent occasionally surfaces its learning ("I noticed you tend to remove overly dramatic descriptions, so I kept this restrained").
3. **No surveillance feeling**: Users do not feel monitored. Edit tracking is invisible unless the Agent explicitly references it in conversation.
4. **Immediate feedback loop**: Edit context influences the very next generation after edits occur (not delayed by multiple rounds).
5. **Works within current architecture**: Integrates with existing DROP ZONE Agent (LLM API + system prompt), tRPC data layer, and localStorage persistence patterns.

---

## Key Decisions

### 1. Approach: Diff Snapshots + Semantic Annotation

**Chosen mechanism**: Capture state snapshots at key moments, compute diffs between snapshots, use LLM to generate semantic annotations, inject annotations into Agent's system prompt.

**Why this approach**:
- Lower implementation cost than event-stream tracking (no need to instrument every edit point)
- Fast validation cycle (can verify "does Agent actually use edit context" within 2-3 weeks)
- Appropriate for prototype stage (lightweight, not over-engineered)
- Leaves room for Phase 2 upgrade to fine-grained event tracking if needed

**Rejected alternatives**:
- Event stream + real-time digest: Too complex for current stage, requires event aggregation logic and pattern recognition rules
- User annotation + Agent inference: Interrupts creative flow, depends on user willingness to explain every edit

### 2. Scope: Story-Driven Path Only

**In scope**:
- StoryCardsBoard: card deletions, additions, content modifications (title/content)
- ScriptViewer: dialogue modifications, scene description rewrites
- ShotTable: shot deletions, parameter modifications (shot size, focal length, etc.)
- StoryAgentChat: user re-statements/corrections reflected in conversation history

**Out of scope (deferred)**:
- Material-driven path (DropZone, TemplateDraft edits)
- Cross-project aesthetic fingerprinting
- User-facing "edit history" UI
- Undo/redo functionality
- Fine-grained conversation edit tracking (handled via existing conversation history)

### 3. Snapshot Trigger Strategy: Hybrid Mode

**Trigger conditions**:
- **Primary**: User explicitly requests generation ("continue the story", "generate next scene")
- **Fallback**: Auto-save if time since last snapshot > threshold (5-10 minutes) AND edits detected

**Why hybrid**:
- Primary trigger aligns with user intent ("now the Agent should see my edits")
- Fallback protects against data loss if user edits but doesn't trigger generation for a while
- Clear mental model: snapshots happen around generation boundaries

**Implementation note**: Auto-save is silent (no UI feedback), but annotation only happens on explicit generation request to avoid premature semantic inference.

### 4. Semantic Annotation: Synchronous, Two-Layer

**Timing**: Synchronous — compute diff, call LLM for annotation, then generate Agent response.

**Why synchronous**:
- Immediate feedback (user sees Agent adapt in the very next response)
- Easier to validate during prototype stage
- Acceptable latency for current user (founder self-use)
- Can optimize to async in Phase 2 if latency becomes an issue

**Annotation structure**: Two layers to balance specificity and generalization.

```typescript
{
  // Layer 1: Factual changes (what happened)
  factualChanges: [
    "删除了2张包含'父亲'角色的卡片",
    "将'愤怒地摔门'改写为'沉默地离开'",
    "保留了所有关于'胸口发紧'的身体感受描述"
  ],

  // Layer 2: Inferred preferences (what it means)
  inferredPreferences: [
    "倾向避免直接提及家庭冲突的核心角色",
    "倾向用克制的动作替代激烈的情绪爆发",
    "重视身体感受作为情绪的载体"
  ]
}
```

**Why two layers**:
- Factual layer: gives Agent concrete reference ("user deleted X")
- Preference layer: gives Agent generalizable direction ("user prefers restrained style")
- If LLM inference is wrong, factual layer still provides grounding

### 5. Diff Granularity: Track Add/Delete/Modify, Ignore Metadata

**Tracked changes**:
- Card/shot deletions and additions
- Content modifications (title, content, dialogue, scene descriptions)

**Ignored changes**:
- Order/sequence changes
- Importance/priority metadata changes
- Minor formatting adjustments

**Why this granularity**:
- Deletions and rewrites are strong aesthetic signals
- Order changes are organizational behavior, not aesthetic preference
- Reduces noise in semantic annotation
- Can expand to metadata in Phase 2 if patterns emerge

### 6. Prompt Injection Strategy

**Location**: Dynamic section in DROP ZONE Agent's system prompt, inserted before each generation.

**Content**: Summary of recent 3-5 annotations (to avoid prompt bloat).

**Format**:
```
=== 用户编辑偏好（基于本项目历史） ===

最近的编辑事实：
- 删除了2张包含'父亲'的卡片
- 将'愤怒地摔门'改为'沉默地离开'
- 保留了所有关于'胸口发紧'的身体感受

推断的创作偏好：
- 避免直接提及冲突核心，倾向克制表达
- 重视身体感受作为情绪载体

请在生成新内容时参考这些偏好。
===
```

**Recency weighting**: Most recent 3-5 annotations. Older annotations are archived but not injected (to keep prompt concise).

### 7. Transparency Strategy: Semi-Transparent with Explicit Moments

**User experience philosophy**: "Understood, not monitored."

**Transparency mechanisms**:
- Agent occasionally surfaces its learning in conversation:
  - "这次我生成得更克制了，没有直接的对抗对话，而是通过'他低头切菜，刀落在砧板上的声音很重'来传递紧张感。这样符合你之前的风格吗？"
  - "我注意到你倾向于删除过于戏剧化的描述，所以这次我..."
- Frequency control: Not every response (avoid being verbose), roughly every 3-5 rounds when applying learned preferences
- No user-facing "edit history" UI in this phase

**What users don't see**:
- Raw snapshot data
- Diff computation details
- Semantic annotation process
- Full edit history timeline

---

## Requirements

### Data Model

**R1. EditSnapshot table**
- Stores project state at snapshot moments
- Fields: `id`, `projectId`, `sessionId`, `timestamp`, `state` (JSON containing cards/script/shots), `previousSnapshotId`
- State structure matches current frontend data models (StoryCard[], ScriptContent, ShotRow[])

**R2. SemanticAnnotation table**
- Stores LLM-generated semantic tags for each diff
- Fields: `id`, `snapshotId`, `previousSnapshotId`, `factualChanges` (string[]), `inferredPreferences` (string[]), `timestamp`
- Links to snapshot pairs (current and previous)

**R3. Snapshot retention policy**
- Keep all snapshots for current project session
- Archive snapshots older than 30 days (move to cold storage, not deleted)
- No cross-project snapshot linking in Phase 1

### Snapshot Capture

**R4. Primary trigger: explicit generation request**
- When user sends message requesting generation (detected via intent classification or explicit UI action)
- Capture current state (cards, script, shots) before Agent generates response
- Compare with previous snapshot to compute diff

**R5. Fallback trigger: auto-save on edit activity**
- If time since last snapshot > 5 minutes AND edits detected (state change in cards/script/shots)
- Silently save snapshot (no UI feedback)
- Do NOT generate semantic annotation yet (wait for next explicit generation)

**R6. Edit detection mechanism**
- Frontend tracks state changes via React refs or state comparison
- Detects: card array length change, card content change, script content change, shot array/content change
- Does NOT trigger on: panel collapse state, UI tweaks, theme changes

### Diff Computation

**R7. Diff algorithm for cards**
- Detect deletions: cards in previous snapshot but not in current (match by `id`)
- Detect additions: cards in current snapshot but not in previous
- Detect modifications: cards with same `id` but different `title` or `content`
- Ignore: order changes, `importance` changes, `createdAt` changes

**R8. Diff algorithm for script**
- Detect content modifications: compare script text/structure
- Track: dialogue changes, scene description rewrites
- Granularity: paragraph-level or scene-level (not character-level)

**R9. Diff algorithm for shots**
- Detect deletions: shots in previous but not in current (match by `id`)
- Detect additions: shots in current but not in previous
- Detect modifications: shots with same `id` but different parameters (shotSize, focalLength, etc.)
- Ignore: readiness score changes, status changes (these are system-generated)

**R10. Diff output structure**
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

### Semantic Annotation

**R11. LLM annotation call**
- Triggered synchronously after diff computation, before Agent response generation
- Input: EditDiff structure + previous annotation context (last 2-3 annotations for continuity)
- Output: SemanticAnnotation with factualChanges and inferredPreferences arrays

**R12. Annotation prompt template**
- Instructs LLM to generate two-layer annotation
- Factual layer: objective description of changes ("删除了X", "将Y改为Z")
- Preference layer: inferred aesthetic/creative preferences ("倾向于...", "重视...")
- Prompt includes examples to guide format and tone

**R13. Annotation prompt example**
```
你是一个创作分析助手。用户在影视故事创作中做了以下编辑：

删除的卡片：
- "父亲在厨房里沉默地切菜"
- "儿子愤怒地摔门而出"

修改的卡片：
- 原内容："他愤怒地喊道：'我受够了！'"
- 新内容："他低声说：'我需要出去走走。'"

请生成两层标注：

1. 事实描述（客观陈述发生了什么变化）
2. 推断偏好（这些变化反映了什么创作倾向）

输出格式：
{
  "factualChanges": ["...", "..."],
  "inferredPreferences": ["...", "..."]
}
```

**R14. Annotation error handling**
- If LLM call fails: log error, use raw diff as fallback (inject factual changes only, skip preference inference)
- If LLM returns malformed JSON: parse best-effort, fall back to raw diff if unparseable
- Never block Agent generation due to annotation failure

### Prompt Injection

**R15. System prompt augmentation**
- Before each Agent generation, retrieve recent 3-5 SemanticAnnotations for current project
- Format as structured text block (see format in Key Decisions §6)
- Insert into system prompt as dynamic section

**R16. Annotation recency window**
- Use most recent 3-5 annotations (configurable)
- If fewer than 3 annotations exist, use all available
- Older annotations are not injected but remain in database for future analysis

**R17. Prompt injection position**
- Insert after Agent identity/role definition, before conversation history
- Clearly delimited with section markers (`=== 用户编辑偏好 ===`)
- Instructs Agent to "参考这些偏好" (reference these preferences)

### Agent Transparency

**R18. Explicit learning moments**
- Agent occasionally mentions learned preferences in responses
- Trigger conditions: when applying a learned preference that significantly shapes generation
- Frequency: roughly every 3-5 responses (not every response)
- Tone: conversational, not mechanical ("我注意到..." not "系统检测到...")

**R19. Transparency prompt guidance**
- System prompt includes instruction: "当你应用了用户的编辑偏好时，可以偶尔提及，但不要每次都说。保持自然对话感。"
- Examples provided in system prompt to guide tone

**R20. No user-facing edit history UI**
- Users cannot view raw snapshots or diffs
- Users cannot view semantic annotations directly
- Only transparency mechanism is Agent's conversational mentions

### Integration Points

**R21. Frontend snapshot capture**
- Add snapshot capture logic to StoryAgentContext or equivalent state management layer
- Trigger on user message send (primary) and periodic auto-save (fallback)
- Call tRPC mutation to save snapshot

**R22. Backend snapshot storage**
- Add tRPC router endpoints: `editContext.saveSnapshot`, `editContext.getRecentAnnotations`
- Store snapshots and annotations in database (Prisma schema updates)
- Compute diff server-side (not in frontend)

**R23. Backend annotation generation**
- Add LLM annotation service (reuse existing LLM client infrastructure)
- Call annotation LLM synchronously after diff computation
- Store annotation in database before returning to Agent generation flow

**R24. Agent prompt construction**
- Modify Agent generation endpoint to fetch recent annotations before calling LLM
- Inject formatted annotation block into system prompt
- Existing conversation history and other prompt components remain unchanged

### Performance & Scalability

**R25. Snapshot size optimization**
- Store only necessary fields in snapshot state (exclude UI-only fields, computed fields)
- Consider JSON compression for large script content
- Target: snapshot size < 50KB for typical project state

**R26. Annotation LLM model selection**
- Use cost-effective model for annotation (e.g., GPT-4o-mini, Claude Haiku)
- Annotation quality matters but doesn't need top-tier reasoning
- Estimated cost: ~$0.01-0.02 per annotation

**R27. Latency budget**
- Snapshot save: < 200ms
- Diff computation: < 500ms
- Annotation generation: < 2s (acceptable for prototype stage)
- Total added latency: ~2.5s before Agent response (acceptable for current user)

---

## Acceptance Examples

**AE1. Basic edit capture and adaptation** (Covers R4, R7, R11, R15)
- Given: User deletes 2 story cards containing "父亲" character
- When: User sends message "继续生成下一个场景"
- Then: System captures snapshot, computes diff (2 card deletions), generates semantic annotation ("倾向避免直接提及父亲角色"), injects into Agent prompt
- And: Agent's next generation avoids mentioning "父亲" character

**AE2. Rewrite pattern recognition** (Covers R7, R11, R15)
- Given: User modifies card from "他愤怒地喊道" to "他低声说"
- When: User requests next generation
- Then: Semantic annotation includes "倾向用克制表达替代激烈情绪"
- And: Agent's next generation uses restrained emotional expression

**AE3. Transparent learning moment** (Covers R18, R19)
- Given: Agent has learned user prefers restrained style (from previous annotations)
- When: Agent generates new scene applying this preference
- Then: Agent's response includes: "这次我生成得更克制了，没有直接的对抗对话。这样符合你的风格吗？"
- And: Frequency is controlled (not every response)

**AE4. Auto-save fallback** (Covers R5, R6)
- Given: User edits 3 cards but doesn't request generation
- When: 6 minutes pass since last snapshot
- Then: System silently saves snapshot (no annotation yet)
- And: Next time user requests generation, diff is computed from this auto-saved snapshot

**AE5. Annotation failure graceful degradation** (Covers R14)
- Given: LLM annotation call fails (network error, API timeout)
- When: System attempts to generate Agent response
- Then: System logs error, uses raw diff as fallback (factual changes only)
- And: Agent generation proceeds without blocking

**AE6. Multi-modal diff capture** (Covers R7, R8, R9)
- Given: User deletes 1 card, modifies 1 script section, deletes 1 shot
- When: Snapshot is captured and diff computed
- Then: Diff includes all three change types (card deletion, script modification, shot deletion)
- And: Semantic annotation reflects patterns across all three modalities

---

## Non-Goals (Explicit Exclusions)

- **Cross-project aesthetic fingerprinting**: User-level preference profiles that persist across projects (deferred to Phase 2)
- **Material-driven path edit tracking**: Edits in DropZone, TemplateDraft, Timeline (different workflow, separate feature)
- **User-facing edit history UI**: Timeline view, edit playback, "undo" functionality (not needed for semi-transparent approach)
- **Real-time collaborative editing**: Multi-user edit conflict resolution (not in current scope)
- **Fine-grained conversation edit tracking**: Detecting when user "corrects" themselves mid-conversation (handled via existing conversation history)
- **Preference export/import**: Sharing aesthetic profiles between users (no use case yet)

---

## Open Questions

### Deferred to Planning

- [Affects R22][Technical] Exact Prisma schema for EditSnapshot and SemanticAnnotation tables — field types, indexes, relations
- [Affects R21][Technical] Where exactly in StoryAgentContext to insert snapshot capture logic — before message send or after state update?
- [Affects R13][Needs experimentation] Optimal annotation prompt template — what examples and instructions produce best semantic tags?
- [Affects R16][Product] Exact recency window (3 vs 5 annotations) — test with real usage to find sweet spot
- [Affects R26][Technical] Which LLM model for annotation — GPT-4o-mini vs Claude Haiku vs other, based on cost/quality tradeoff
- [Affects R27][Technical] Should annotation be truly synchronous or use a short-timeout async pattern (e.g., 2s timeout, fallback to raw diff)?

### Needs User Validation

- [Affects R18][Product] Transparency frequency — is "every 3-5 responses" too much or too little? Needs real usage feedback.
- [Affects R19][Product] Transparency tone — does "我注意到..." feel natural or mechanical? May need iteration based on user reaction.
- [Affects R5][Product] Auto-save threshold — is 5 minutes the right interval, or should it be longer/shorter?

---

## Dependencies / Assumptions

- **Existing LLM infrastructure**: System already has LLM client for DROP ZONE Agent; annotation reuses this infrastructure
- **tRPC data layer**: Frontend-backend communication uses tRPC; new endpoints follow existing patterns
- **Prisma ORM**: Database schema changes use Prisma migrations
- **StoryAgentContext persistence**: Existing localStorage pattern for conversation history can be extended for snapshot metadata
- **User is solo creator**: No multi-user collaboration in current phase, so no edit conflict resolution needed
- **Agent uses system prompt**: DROP ZONE Agent architecture supports dynamic system prompt injection (confirmed in drop-zone-agent-training.md)

---

## Success Metrics (Post-Launch)

- **Adaptation rate**: % of generations where Agent successfully applies learned preferences (target: >70% when clear pattern exists)
- **User satisfaction**: Qualitative feedback on "does Agent feel like it understands you" (founder self-assessment initially)
- **Edit reduction**: Do users edit less after Agent learns their style? (measure edit count per generation over time)
- **Transparency reception**: Do users notice and appreciate Agent's learning mentions, or find them annoying? (qualitative feedback)

---

## Implementation Phases (Suggested)

**Phase 1a: Snapshot infrastructure** (1 week)
- Prisma schema for EditSnapshot table
- tRPC endpoints for snapshot save/retrieve
- Frontend snapshot capture on explicit generation trigger
- Basic diff computation (cards only, simple add/delete)

**Phase 1b: Semantic annotation** (1 week)
- SemanticAnnotation table and endpoints
- LLM annotation service with two-layer prompt
- Integration with snapshot diff
- Error handling and fallback logic

**Phase 1c: Prompt injection** (3-4 days)
- Fetch recent annotations in Agent generation flow
- Format and inject into system prompt
- Test that Agent actually uses injected context

**Phase 1d: Transparency layer** (2-3 days)
- Add transparency instructions to Agent system prompt
- Test frequency and tone of learning mentions
- Iterate based on initial usage

**Phase 1e: Auto-save and polish** (3-4 days)
- Implement auto-save fallback trigger
- Expand diff computation to script and shots
- Performance optimization and monitoring

**Total estimated time**: 3-4 weeks for full implementation and initial validation.

---

## Related Documents

- `docs/PRODUCT_BRIEF.md` — Drinking Time dual-engine architecture, Analysis Engine and Creation Engine definitions
- `docs/drop-zone-agent-training.md` — DROP ZONE Agent current behavior, system prompt strategy, training data structure
- `docs/brainstorms/analysis-page-architecture-requirements.md` — Frontend architecture, story-driven vs material-driven paths
- Ideation memo (external) — Original #1 and #2 feature ideas, research context on behavioral weighting
