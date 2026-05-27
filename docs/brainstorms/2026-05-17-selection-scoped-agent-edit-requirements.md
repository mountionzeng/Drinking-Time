---
date: 2026-05-17
topic: selection-scoped-agent-edit
---

# Selection-Scoped Agent Edit — Rewrite Just the Highlighted Text

## Summary

In the already-editable Cards / Script / Shot Production Table, the creator selects a span of text; a floating instruction box appears at the selection; they type an instruction; the Agent rewrites only that span and shows an original-vs-new comparison in place; on accept, the new text is written back precisely into that span via the field-commit/persistence already built. One selection-level mechanism, surface-agnostic, covering all three surfaces. No routing through the existing chat.

---

## Problem Frame

The creator can now manually edit Cards/Script/Shot fields and the first generation is a standard draft they bend toward their own voice. But the only ways to change a specific phrase today are: retype it by hand (precise but slow, and the creator may not know the better wording), or ask the Agent in chat to regenerate the whole field/story (fast but destroys everything else and loses locality). There is no way to point at exactly one phrase and say "make just this better, like this" and get a targeted Agent rewrite without collateral change. The precision the creator wants — keep everything, improve this one bit — has no tool.

A related but separate concern, protecting accepted edits from later Agent regeneration, lives in `docs/brainstorms/2026-05-13-editing-foundation-recognition-requirements.md` and is not built here; this feature assumes it coexists.

---

## Actors

- A1. Creator: selects a span, gives a free-form instruction, judges the proposed rewrite, accepts or discards.
- A2. Story Agent: receives the selected text + surrounding context + instruction, returns a rewrite of only that span.

---

## Key Flows

- F1. Select → instruct → compare → accept
  - **Trigger:** Creator selects (highlights) a non-empty text span inside one editable field in Cards, Script, or Shot Table.
  - **Actors:** A1, A2
  - **Steps:** Selection detected within a single editable field → floating instruction box appears anchored at the selection → creator types an instruction and submits → Agent returns a rewrite of only the selected span → original-vs-new comparison shown in place → creator accepts → the new text replaces exactly the selected span and is committed/persisted through that field's existing commit path; creator discards → nothing changes.
  - **Outcome:** Only the selected span changed; the rest of the field is untouched; the change persists like a manual edit.
  - **Covered by:** R1, R2, R3, R4, R5, R6, R7, R8

---

## Requirements

**Selection & trigger**
- R1. When the creator selects a non-empty span of text inside a single editable field (Cards content, Script title/logline/scene visual/scene emotion/arc, Shot Table subject/action/dialogue), a floating affordance appears anchored to the selection.
- R2. A selection that is empty, or spans more than one field / card / scene, does not trigger the affordance (single-span, single-field only).
- R3. With no active selection the feature is inert; existing editing and chat behave exactly as before.

**Instruction & Agent**
- R4. The creator types a free-form instruction; on submit, the Agent receives the selected text, the field's surrounding context, and the instruction, and returns a rewrite of only that span.
- R5. The Agent rewrites only the selected span; it does not regenerate or alter the surrounding field, card, scene, or shot.

**Compare & apply**
- R6. The Agent's result is shown as an original-vs-new comparison at the selection site; it is not applied automatically.
- R7. On accept, the new text replaces exactly the selected span within the field and is committed and persisted through the same field-commit path used for manual edits; on discard, the field is unchanged.
- R8. An accepted selection edit is treated as creator-owned content (same status as a manual edit) for the purposes of the separate no-overwrite contract.

**Coverage**
- R9. The same single mechanism works on all three surfaces — Story Cards content, Script (title, logline, each scene's visual + emotion, arc), and Shot Table (subject, action, dialogue) — without per-surface bespoke implementations.

---

## Acceptance Examples

- AE1. **Covers R1, R4, R6, R7.** Given the creator highlights one sentence in a Script scene, when they type "改得更克制" and submit, then the Agent returns a rewrite of just that sentence, a comparison is shown, and on accept only that sentence changes and survives reload.
- AE2. **Covers R2.** Given the creator's selection spans two different scene fields, when they release the selection, then no edit affordance appears.
- AE3. **Covers R5.** Given a 3-sentence card where the creator selected sentence 2, when the Agent returns its rewrite, then sentences 1 and 3 are byte-identical to before.
- AE4. **Covers R7.** Given the Agent's proposal is shown, when the creator discards it, then the selected text and the whole field are exactly as before.
- AE5. **Covers R9.** Given the same gesture (select → instruct → accept) performed once in Cards, once in Script, once in Shot Table, then all three behave identically and persist.
- AE6. **Covers R3.** Given no text is selected, when the creator uses the page normally, then no selection affordance ever appears and chat/editing are unchanged.

---

## Success Criteria

- The creator can improve one phrase with an Agent rewrite without retyping it and without disturbing anything else in the field.
- The same gesture works the same way in Cards, Script, and Shot Table — the creator learns it once.
- A rejected proposal never mutates the document; an accepted one persists exactly like a manual edit.
- A downstream planner can build without inventing the trigger model, the apply model, the surface coverage, or the write-back path.

---

## Scope Boundaries

- Per-surface bespoke implementations (rejected: contradicts the one-mechanism win condition).
- Routing the selection through the existing StoryAgentChat as the mechanism (considered; rejected in favor of in-place locality).
- Multi-span / cross-field / cross-card / cross-scene batch selection edits.
- Preset one-click actions (润色 / 缩短 / 扩写); v1 is free-form instruction only — presets may layer on later.
- Agent deciding how to edit without an instruction.
- The no-overwrite / row-lock / re-tag contract itself (separate `2026-05-13` doc; this feature coexists with it, does not build it).
- Edits as a style-learning signal (`2026-05-11` doc).

---

## Key Decisions

- **Mechanism: generic selection-edit layer, not chat-routed.** Operates at the selection level inside any editable region; surface-agnostic so one chain covers all three. Chosen over per-surface builds (contradicts one-chain) and over feeding the selection into the existing chat (loses the in-place locality that is the point of "edit just this bit").
- **Trigger: select + free-form instruction.** Chosen over preset actions (less flexible) and no-instruction auto-edit (uncontrollable).
- **Apply: propose → compare → confirm.** Chosen over in-place replace; the Agent is non-deterministic, so a bad rewrite must never silently destroy the original — consistent with the trust theme of the editing work.
- **Write-back reuses the existing field-commit/persistence** built for manual editing; no new persistence mechanism.

---

## Dependencies / Assumptions

- Builds directly on the inline editing shipped this session: `updateCardContent`, `updateScriptMeta`, `updateScriptScene`, `updateStoryShotField` in `client/src/features/storyAgent/StoryAgentContext.tsx`, surfaced in `StoryCardsBoard.tsx`, `ScriptViewer.tsx`, `client/src/features/analysis/views/ShotTable.tsx`. The accepted rewrite must round-trip through these.
- Reuses an existing LLM endpoint (e.g., `/api/archive/story-agent-chat`) or a focused new one; behavior: input {selected text, surrounding field context, instruction} → output rewritten span. Exact endpoint is a planning decision.
- Assumes the separate no-overwrite/row-lock contract will treat an accepted selection edit as creator-owned; until that contract is wired in React, accepted edits carry the same regenerate-overwrite exposure as manual edits.
- Solo creator, single project — no concurrency.

---

## Outstanding Questions

### Deferred to Planning

- [Affects R1, R7][Technical] How the selection is anchored to a field and offsets are computed/restored across React re-renders, and the exact write-back trigger into the existing commit path.
- [Affects R4][Technical] Reuse `story-agent-chat` vs a focused selection-rewrite endpoint; prompt shape for "rewrite only this span per this instruction, keep register/format".
- [Affects R6][Needs design] Comparison UI shape (inline diff vs side-by-side) and the floating affordance's placement/dismissal rules.
- [Affects R5][Needs experimentation] Guardrails so the Agent returns only the span rewrite (length/format discipline) and degrades safely on model/network failure without mutating the field.
