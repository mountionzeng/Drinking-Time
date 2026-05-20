---
title: "feat: Add inline selection edit with style learning"
type: feat
status: active
date: 2026-05-20
origin: docs/brainstorms/inline-selection-edit-requirements.md
---

# feat: Add inline selection edit with style learning

## Summary

Adds a "select text → quote into chat → tell Agent how to change it → precise in-place update" flow across all content areas (cards, scripts, shots, chat replies). Each correction feeds a `semanticAnnotation` through the existing pipeline so future generation absorbs the user's style preferences. The approach uses a global `selectionchange` listener to avoid modifying each content component, a new `storyAgent.selectionEdit` tRPC mutation with a focused prompt for precision editing, and a quote block UI above the chat input following the WeChat "quote reply" pattern.

---

## Problem Frame

Users can manually edit content via `contentEditable` or describe changes in chat, but neither gives the Agent a precise "original → intent → correction" signal. Manual edits bypass the Agent entirely (no style learning); chat-based descriptions lack positional precision (Agent may rewrite too much). (see origin: `docs/brainstorms/inline-selection-edit-requirements.md`)

---

## Requirements

- R1. User can select text in any content area (card, script, shot, chat reply) and see it quoted in the chat input
- R2. Agent modifies only the selected portion without altering surrounding content
- R3. Each correction is recorded as a `semanticAnnotation` and influences subsequent generation
- R4. The flow feels as natural as "quoting a message" in a messaging app
- R5. If the user expresses approval rather than requesting a change, record the preference without modifying text

---

## Scope Boundaries

- Multi-selection (selecting multiple passages at once)
- Visual diff / change history UI
- Cross-project global style preferences
- Undo/revert UI for inline edits

### Deferred to Follow-Up Work

- Keyboard shortcut to trigger quote (e.g., Cmd+Shift+Q): evaluate after initial launch based on usage patterns

---

## Context & Research

### Relevant Code and Patterns

- **contentEditable pattern:** `StoryCardsBoard.tsx` (CardItem), `ScriptViewer.tsx` (EditableText), `ShotTable.tsx` (EditableLine) — all use blur-to-commit with nayin accent focus ring
- **Chat message rendering:** `StoryAgentChat.tsx` — messages rendered as `<p className="whitespace-pre-wrap">{m.content}</p>`, input area at bottom with textarea + send button
- **State management:** `StoryAgentContext.tsx` — `sendMessage()` flow: create user ChatMessage → snapshot → `chatMut.mutateAsync()` → create assistant message → persist
- **Update methods:** `updateCardContent()`, `updateScriptMeta()`, `updateScriptScene()`, `updateStoryShotField()` — all follow `setXxx() + saveArchiveStory()` pattern
- **Edit context injection:** `formatEditContextBlock()` in `storyAgent.ts:340-393` — collects facts + preferences from recent annotations, injects into system prompt
- **Semantic annotation:** `semanticAnnotation.ts` — `generateAnnotation()` with circuit breaker, LLM-based preference inference from diffs
- **Chat tRPC mutation:** `routers.ts:460-505` — `storyAgent.chat` accepts message, history, projectId, etc.
- **ChatMessage type:** `client/src/features/storyAgent/types.ts` — `{ id, role, content, timestamp, spawnedCardId? }`

---

## Key Technical Decisions

- **Separate `selectionEdit` mutation vs reusing `chat`:** New mutation. The story agent chat prompt is massive (174 lines) and optimized for open-ended conversation + card extraction. Selection edit needs a focused "modify only this text" prompt. Mixing them would either bloat the chat prompt or produce imprecise edits. (see origin: Key Decisions table)
- **Global `selectionchange` listener vs per-component:** Global listener on `document`. Avoids modifying 4+ content components. The listener identifies which content area the selection falls in by walking up the DOM to find `data-selection-source` attributes added to content containers.
- **Quote block state in `StoryAgentContext`:** Selection state must be accessible from all panels (selection happens in center/right panels, quote block renders in left panel). Context is the existing cross-panel state bus.
- **Annotation without snapshot:** Inline corrections don't change the full project state like a whole-state diff. Instead, create a lightweight snapshot with a synthetic diff that only contains the single field modification, then pipe it through the existing `generateAnnotation()`. This avoids a new annotation path while giving the LLM richer per-word signal.

---

## Open Questions

### Resolved During Planning

- **How to identify which entity a selection belongs to?** Add `data-selection-source` attributes (e.g., `data-selection-source="card:abc123"`, `data-selection-source="script-scene:2"`) to content containers. The global listener walks up from `anchorNode` to find the nearest attributed element.
- **Should the Agent reply appear as a normal chat message?** Yes — it's a regular assistant message in the conversation, preserving chat history continuity. The in-place content update happens as a side effect after the reply.

### Deferred to Implementation

- Exact wording of the selection edit system prompt — needs iteration with real content to tune precision
- How to handle selections that span across two entities (e.g., card content into card title) — likely: ignore, only accept selections within a single `data-selection-source` boundary

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
User selects text in card/script/shot/chat
  ↓
document 'selectionchange' listener fires
  ↓
Walk up from anchorNode → find data-selection-source → parse entity type + ID
  ↓
setActiveSelection({ sourceType, sourceId, selectedText, fullText })
  → Quote block appears above chat input
  ↓
User types instruction + sends
  ↓
sendSelectionEdit(instruction) in StoryAgentContext:
  ├─ Creates user ChatMessage with selectionQuote metadata
  ├─ Calls storyAgent.selectionEdit mutation (new)
  │   ├─ Receives: fullText, selectedText, instruction, editContextBlock
  │   ├─ Focused system prompt: "modify only the quoted portion"
  │   ├─ Returns: { reply, modifiedFullText, isApprovalOnly }
  │   └─ If isApprovalOnly: skip text update, record preference only
  ├─ Creates assistant ChatMessage with reply
  ├─ Applies modifiedFullText back to source entity via existing updateXxx()
  └─ Triggers semanticAnnotation via saveSnapshot (synthetic diff)
```

---

## Implementation Units

### U1. Selection state and global listener

**Goal:** Capture text selections across all content areas and store them in context state.

**Requirements:** R1

**Dependencies:** None

**Files:**
- Create: `client/src/features/storyAgent/hooks/useSelectionCapture.ts`
- Modify: `client/src/features/storyAgent/StoryAgentContext.tsx`
- Modify: `client/src/features/storyAgent/types.ts`
- Modify: `client/src/features/storyAgent/views/StoryCardsBoard.tsx`
- Modify: `client/src/features/storyAgent/views/ScriptViewer.tsx`
- Modify: `client/src/features/analysis/views/ShotTable.tsx`
- Modify: `client/src/features/storyAgent/views/StoryAgentChat.tsx`
- Test: `client/src/features/storyAgent/hooks/useSelectionCapture.test.ts`

**Approach:**
- Define `SelectionState` type: `{ sourceType: 'card' | 'script-scene' | 'script-meta' | 'shot' | 'chat', sourceId: string, selectedText: string, fullText: string } | null`
- Add `activeSelection` + `setActiveSelection` + `clearSelection` to `StoryAgentContext`
- Create `useSelectionCapture` hook: listens to `document selectionchange`, debounced (~200ms), extracts `Selection` object, walks up DOM to find `data-selection-source`, resolves `fullText` from the container's `innerText`, calls `setActiveSelection`
- Add `data-selection-source` attributes to content containers in StoryCardsBoard (`card:{id}`), ScriptViewer (`script-scene:{index}`, `script-meta:{field}`), ShotTable (`shot:{index}:{field}`), and StoryAgentChat (`chat:{messageId}`)
- Mount `useSelectionCapture` in the workspace layout component that wraps all three panels

**Patterns to follow:**
- `useComposition.ts` hook pattern for document-level event listeners
- `StoryAgentContext` state management pattern (useState + expose via context value)

**Test scenarios:**
- Happy path: selection within a card content area → `activeSelection` populated with correct sourceType `'card'`, sourceId matching card ID, selectedText matching the browser selection string
- Happy path: selection within a chat message → sourceType `'chat'`, sourceId = message ID
- Edge case: selection spans outside any `data-selection-source` container → `activeSelection` remains null
- Edge case: empty selection (click without drag) → `activeSelection` cleared to null
- Edge case: new selection replaces previous one → only one `activeSelection` at a time

**Verification:**
- Selecting text in any content area populates `activeSelection` with correct metadata
- Clicking elsewhere or making an empty selection clears the state

---

### U2. Quote block UI in chat input

**Goal:** Render a quote block above the chat textarea showing the active selection, with dismiss button.

**Requirements:** R1, R4

**Dependencies:** U1

**Files:**
- Modify: `client/src/features/storyAgent/views/StoryAgentChat.tsx`
- Test: `client/src/features/storyAgent/views/StoryAgentChat.test.tsx`

**Approach:**
- Between the `border-t` input container div and the textarea, render a conditional quote block when `activeSelection` is non-null
- Quote block shows: source label (formatted from sourceType + sourceId, e.g., "卡片 3", "场景 2", "小酌回复"), selected text (truncated to ~50 chars with ellipsis), and an (x) dismiss button
- Dismiss calls `clearSelection()`
- Style: use nayin accent border-left, muted background, small text — consistent with the existing card/message styling (rounded-lg, panel-border, nayin-glow)
- Source label formatting: map sourceType to Chinese labels, resolve card index from cards array by ID, resolve scene index, etc.

**Patterns to follow:**
- `spawnedCardId` indicator block pattern in StoryAgentChat (lines 123-129) for conditional metadata rendering within the chat area
- Nayin-themed styling: `var(--nayin-accent)`, `var(--nayin-glow)`, `var(--panel-border)`

**Test scenarios:**
- Happy path: when `activeSelection` is set, quote block renders with source label, truncated text, and dismiss button
- Happy path: clicking dismiss button clears `activeSelection` and quote block disappears
- Edge case: selected text longer than 50 chars → truncated with "…"
- Edge case: source label correctly maps `card:abc123` → "卡片 3" (resolved from cards array position)

**Verification:**
- Quote block appears/disappears reactively based on selection state
- Dismiss clears both the quote block and the visual highlight

---

### U3. Backend selection edit mutation

**Goal:** New tRPC mutation that takes a selection context + user instruction and returns a precise text modification.

**Requirements:** R2, R5

**Dependencies:** None (can be built in parallel with U1/U2)

**Files:**
- Modify: `server/archive/storyAgent.ts` — add `buildSelectionEditPrompt()` and `handleSelectionEdit()`
- Modify: `server/routers.ts` — add `storyAgent.selectionEdit` procedure
- Test: `server/archive/storyAgent.selectionEdit.test.ts`

**Approach:**
- New tRPC mutation `storyAgent.selectionEdit` with input: `{ fullText, selectedText, instruction, projectId?, history? }`
- Build a focused system prompt: instruct the LLM to return JSON `{ reply: string, modifiedFullText: string, isApprovalOnly: boolean }` — reply is the chat message, modifiedFullText is the full entity text with only the selected portion changed, isApprovalOnly is true when user expressed approval rather than requesting changes
- Include recent `editContextBlock` (same as chat agent) so the edit LLM is aware of existing style preferences
- Keep history minimal — last 3-5 messages for conversational context, not the full chat history
- Use `parseJsonLoose` (existing utility in storyAgent.ts) to extract the response

**Patterns to follow:**
- `replyFromStoryAgent()` structure: fetch annotations → build prompt → invoke LLM → parse → return
- `storyAgent.chat` tRPC procedure input validation pattern

**Test scenarios:**
- Happy path: fullText "阳光洒在窗台上，猫咪蜷缩着", selectedText "阳光洒在窗台上", instruction "换成更冷的氛围" → modifiedFullText changes only the selected portion, rest unchanged
- Happy path: instruction expresses approval ("这个表述很好") → `isApprovalOnly: true`, `modifiedFullText` equals original `fullText`
- Happy path: instruction asks to add content after selection ("后面加一句关于光线的") → modifiedFullText inserts new text after the selected portion
- Error path: LLM returns invalid JSON → graceful fallback with error message in reply
- Error path: selectedText not found in fullText → return error reply, no modification
- Integration: editContextBlock is injected when projectId is provided

**Verification:**
- Mutation returns valid response structure
- Only the selected portion is modified in modifiedFullText
- Approval-only instructions produce no text changes

---

### U4. Frontend send and apply flow

**Goal:** Wire up the chat input to send selection edits and apply the returned modification back to the source entity.

**Requirements:** R2, R4

**Dependencies:** U1, U2, U3

**Files:**
- Modify: `client/src/features/storyAgent/StoryAgentContext.tsx` — add `sendSelectionEdit()` method
- Modify: `client/src/features/storyAgent/views/StoryAgentChat.tsx` — route submit through `sendSelectionEdit` when quote is active
- Test: `client/src/features/storyAgent/StoryAgentContext.test.tsx`

**Approach:**
- Add `sendSelectionEdit(instruction: string)` to `StoryAgentContext`:
  1. Create user `ChatMessage` — content includes instruction, plus a new optional `selectionQuote` field on ChatMessage type for metadata display
  2. Call new `selectionEditMut.mutateAsync()` with fullText, selectedText, instruction, projectId
  3. Create assistant `ChatMessage` with the reply
  4. If not `isApprovalOnly`: apply `modifiedFullText` back to source entity using the appropriate existing update method:
     - `card:{id}` → `updateCardContent(id, modifiedFullText)`
     - `script-scene:{index}` → `updateScriptScene(index, 'visual', modifiedFullText)`
     - `script-meta:{field}` → `updateScriptMeta(field, modifiedFullText)`
     - `shot:{index}:{field}` → `updateStoryShotField(index, field, modifiedFullText)`
     - `chat:{msgId}` → update the message content in messages array directly
  5. Clear `activeSelection`
- In StoryAgentChat: modify `handleSubmit` — if `activeSelection` is non-null, call `sendSelectionEdit(text)` instead of `sendMessage(text)`
- User message in chat should visually show the quoted text above the instruction (render `selectionQuote` if present on the ChatMessage)

**Patterns to follow:**
- `sendMessage()` flow: create user msg → set replying → mutate → create assistant msg → persist → clear replying
- Existing `updateXxx()` methods for applying changes

**Test scenarios:**
- Happy path: user sends instruction with active selection → `selectionEditMut` called with correct params, result applied to source entity, quote cleared
- Happy path: approval-only result → no entity update, annotation still recorded
- Happy path: chat message content updated → messages array reflects new content for that message ID
- Edge case: mutation fails → error toast, selection not cleared (user can retry)
- Integration: user message in chat renders with quoted selection metadata visually distinct from normal messages

**Verification:**
- Selecting text + typing instruction + sending → source entity text updates in-place with only the selected portion changed
- Chat shows both user instruction (with quote) and Agent's reply
- Selection clears after successful edit

---

### U5. Style learning annotation for inline corrections

**Goal:** Feed each inline correction through the existing `semanticAnnotation` pipeline so the Agent learns from precise edits.

**Requirements:** R3

**Dependencies:** U3, U4

**Files:**
- Modify: `client/src/features/storyAgent/StoryAgentContext.tsx` — trigger annotation after successful selection edit
- Modify: `server/services/editContext.ts` — add `saveInlineCorrection()` helper
- Modify: `server/routers.ts` — expose inline correction annotation endpoint if needed
- Test: `server/services/editContext.test.ts`

**Approach:**
- After a successful selection edit (non-approval-only), trigger an annotation:
  1. Client calls `saveSnapshotMut` with the new state (same as current pre-chat snapshot pattern) — this automatically computes a diff that will show the single field change
  2. Since the snapshot diff will be a standard "modified card/script/shot" diff, the existing `generateAnnotation()` picks it up naturally
  3. For richer signal: extend the snapshot input to accept an optional `inlineCorrection` metadata field `{ originalText, modifiedText, instruction, sourceType }` that gets passed through to `generateAnnotation()` so the LLM annotation prompt can include the precise before/after and user intent
- For approval-only: create a snapshot with a synthetic annotation directly (factualChanges: "用户认可了这个表述: '...'", inferredPreferences from LLM)
- Modify `buildUserPrompt()` in `semanticAnnotation.ts` to include inline correction context when present, giving the LLM the highest-quality preference signal

**Patterns to follow:**
- `saveSnapshot()` flow in `sendMessage()` (lines 633-656 of StoryAgentContext.tsx)
- `generateAnnotation()` in `semanticAnnotation.ts` with circuit breaker pattern

**Test scenarios:**
- Happy path: inline correction triggers snapshot → diff shows single field modification → annotation generated with factualChanges describing the word-level change
- Happy path: annotation `inferredPreferences` captures style signal (e.g., "用户将'阳光洒在窗台上'改为'冷光透过百叶窗'，偏好冷色调氛围描写")
- Happy path: approval-only creates annotation with preference but no factual change
- Integration: after several inline corrections, `formatEditContextBlock()` includes the correction-derived preferences in the Agent system prompt
- Edge case: annotation LLM fails → circuit breaker fires, fallback annotation created with facts only

**Verification:**
- Inline corrections appear as `semanticAnnotation` records in the database
- `formatEditContextBlock()` output includes correction-derived preferences
- Subsequent Agent chat responses reflect the learned style

---

## System-Wide Impact

- **Interaction graph:** The global `selectionchange` listener must coexist with existing `contentEditable` blur-to-commit handlers. Selections within a contentEditable element should not interfere with the edit-on-blur flow — the quote block is additive, not replacing inline editing.
- **Error propagation:** Selection edit mutation failures should show a toast and preserve the selection state so the user can retry. They must never corrupt the source entity's content.
- **State lifecycle risks:** Race condition if user manually edits via contentEditable while a selection edit is in-flight for the same entity. Mitigation: disable contentEditable on the source entity while a selection edit is pending.
- **API surface parity:** The new `selectionEdit` mutation is story-agent-specific. No other interfaces need the same change.
- **Integration coverage:** The end-to-end flow (select → quote → send → apply → annotate) crosses 4 layers (DOM listener → React context → tRPC → LLM → DB). Unit tests alone won't prove the full chain.
- **Unchanged invariants:** Existing `sendMessage()` flow, `contentEditable` inline editing, auto-save timer, and snapshot pipeline continue to work unchanged. The new selection edit is an additive path, not a modification of existing paths.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `selectionchange` fires too frequently (every cursor move) | Debounce at ~200ms; ignore empty/collapsed selections |
| contentEditable and selection listener conflict | Selection only activates quote block; blur-to-commit remains independent |
| LLM modifies text outside the selected portion | System prompt explicitly constrains; validate returned text contains unmodified prefix/suffix |
| Selection offsets drift if content is edited concurrently | Disable contentEditable on source entity while selection edit is in-flight |
| Annotation LLM overload from frequent corrections | Existing circuit breaker handles this; corrections are less frequent than chat messages |

---

## Sources & References

- **Origin document:** [docs/brainstorms/inline-selection-edit-requirements.md](docs/brainstorms/inline-selection-edit-requirements.md)
- Related code: `server/archive/storyAgent.ts` (chat handler, system prompt), `server/services/semanticAnnotation.ts` (annotation pipeline), `client/src/features/storyAgent/StoryAgentContext.tsx` (state management)
- Related patterns: `StoryCardsBoard.tsx` CardItem contentEditable, `ScriptViewer.tsx` EditableText
