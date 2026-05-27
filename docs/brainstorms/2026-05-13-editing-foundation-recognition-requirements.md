---
date: 2026-05-13
topic: editing-foundation-and-recognition
---

# Editing Foundation + Recognition Handoff — Shot Production Table & Story Cards (React /analysis)

## Summary

Build inline editing into the live React `/analysis` product — its Shot Production Table, Story Cards, story-meta (logline/theme/arc), and characters are currently read-only by design and cannot be edited at all. Editing must be reliable and persisted; "touch any field → the whole shot/card becomes the creator's, and a later Agent re-classification never wipes that row" must hold as a creator-visible **row-level** guarantee, extended to story-meta and characters; ownership must be durable across reload/device. After a narrative edit, the Agent re-derives that one shot's emotion/beat — the only write it may make on an owned row, never over a hand-set label. The standalone archive prototype (`client/public/archive/drinking-time-workshop-ledger/index.html`) already implements this whole contract and is the **behavioral reference to port from** — but in React the editing and provenance machinery are net-new, not a reuse.

---

## Problem Frame

The Story Agent's first generation is a *standard* output — competent but generic. The product's value is what happens next: the creator edits cards and shots until the result is uniquely theirs. Those edits are the personalization signal, not waste.

That loop does not exist in the shipping product. **Verified root cause:** the live React app at `/analysis` renders the Shot Production Table, Story Cards, and draft views as purely presentational, read-only components. `client/src/features/analysis/views/ShotTable.tsx`, `PromptDistill.tsx`, and `TemplateDraft.tsx` contain no `contentEditable`, inputs, or edit handlers (only filter/sort dropdowns). There is zero `contentEditable` anywhere in `client/src/features`, `client/src/archive`, or `client/src/components`, and `StoryAgentContext` exposes no per-field shot/card edit mutation — only collection-level `setCards`/`setStoryShots` driven by chat/classify/reorder. The creator literally cannot modify the script in the product they use.

The only place editing works is the standalone archive prototype (`client/public/archive/drinking-time-workshop-ledger/index.html`) — verified live: ~105 contentEditable fields, stable focus, edits persist to localStorage, and (after recent work) row-level ownership + story-meta/character no-overwrite + re-tag all function there. Prior work and a now-superseded revision of this doc targeted that prototype. This work re-targets the real product.

A related downstream concern — turning edits into a persistent style/aesthetic signal for *future* generations — is specified separately in `docs/brainstorms/2026-05-11-edit-context-enrichment-requirements.md` and is out of scope here. Note its `editContext.saveSnapshot` tRPC path already exists in the React layer.

---

## Actors

- A1. Creator: edits Story Cards, Shot Production Table fields, story-meta, and characters in `/analysis` to move the standard generation toward their own voice; owns any shot/card they touch, as a whole.
- A2. Story Agent: produces the initial standard output, and after a narrative edit re-derives that one shot's structured labels; must treat any creator-owned shot/card as authoritative and never overwrite it, the single re-tag write excepted.

---

## Key Flows

- F1. Edit and persist a field
  - **Trigger:** Creator edits any field in a Story Card, a shot, story-meta (logline/theme/arc), or a character in `/analysis`.
  - **Actors:** A1
  - **Steps:** Creator focuses a field and changes its content → confirms (blur / commit) → value is saved to StoryAgentContext state and persisted → the whole containing shot/card is marked creator-owned → value and ownership survive reload and project switch.
  - **Outcome:** The edited value persists with no separate save action; the containing row is creator-owned and durable.
  - **Covered by:** R1, R2, R3, R4, R5, R6, R9

- F2. Re-tag after a narrative edit
  - **Trigger:** Creator commits an edit to a shot's narrative content (subject / action / dialogue / emotion).
  - **Actors:** A1, A2
  - **Steps:** Edit commits → shot is now creator-owned → Agent re-derives that shot's emotion/beat → a hand-set label is left untouched; an Agent-derived label is refreshed silently.
  - **Outcome:** Labels stay coherent with edited narrative without erasing creator-set labels; re-tag is the only write A2 makes on the owned row; failure leaves the edit intact and labels unchanged.
  - **Covered by:** R10, R11, R12, R13, R14, R15

- F3. Re-classify without losing edits
  - **Trigger:** A later Agent generation or classify mutation runs on a story that has creator edits.
  - **Actors:** A1, A2
  - **Steps:** Model returns new content → creator-owned shots/cards are preserved whole → creator-edited story-meta and characters are preserved → only untouched rows are refreshed.
  - **Outcome:** No creator edit anywhere is lost to re-classification.
  - **Covered by:** R6, R7, R8, R9

---

## Requirements

**Editing foundation (net-new in React)**
- R1. Every Shot Production Table field — subject, action, dialogue, emotion, beat, shot type, and all technical fields — is directly editable in the `/analysis` UI.
- R2. Every Story Cards field, plus story-meta (logline / theme / arc) and character fields, is directly editable in the `/analysis` UI.
- R3. Editing is available wherever these views render (active project, any stage that shows them) — not gated to a special mode or read-only-by-default.
- R4. An edit commits and persists on a natural boundary (blur / confirm) with no separate save action, and survives reload and project switch via the existing persistence layer.
- R5. A committed edit is never discarded by React re-render or state refresh; an in-progress edit is never interrupted (focus not stolen, typed characters not reverted).

**No-overwrite contract — row-level**
- R6. Committing an edit to *any* field of a shot or Story Card marks that *entire* shot/card as creator-owned (row-level), via a net-new provenance concept in the React state layer.
- R7. When the Agent re-runs generation or classification, a creator-owned shot/card is preserved as a whole — none of its fields are replaced by model output, not only the edited field.
- R8. Creator edits to story-meta (logline, theme, arc) and to characters are preserved on re-classification — currently these are reassigned wholesale; v1 protects them with the same provenance approach.
- R9. Creator ownership/provenance is durable: it survives reload, project switch, and (via the persistence/tRPC layer) a different device or session.
- R10. The only Agent write permitted on a creator-owned shot is the re-tag in R11–R15; no other modification to an owned shot/card.

**Recognition — re-tag on narrative edit**
- R11. After a creator commits an edit to a shot's narrative content (subject / action / dialogue / emotion), the Agent re-derives that shot's structured labels (emotion, beat).
- R12. A label the creator set by hand is sticky: re-tag never overwrites it until the creator changes or clears it themselves.
- R13. Editing only technical fields of a shot does NOT trigger re-tag.
- R14. Re-derivation is scoped to the edited shot only; it never re-scans or re-tags other rows.
- R15. Re-tag is silent (no per-cell confirmation). If it fails, the creator's narrative edit still persists and the label is unchanged; editing is never blocked by recognition.

---

## Acceptance Examples

- AE1. **Covers R4, R5.** Given a shot's dialogue field in `/analysis`, when the creator rewrites it and clicks away, then the new dialogue shows, persists after reload, and is not reverted by a React re-render.
- AE2. **Covers R1, R2.** Given the Shot Production Table and Story Cards are visible, when the creator clicks any field, then it is editable in place (today nothing is).
- AE3. **Covers R6, R7.** Given a shot where the creator edited only the dialogue, when the Agent re-classifies, then that entire shot is exactly as the creator left it, not just the dialogue.
- AE4. **Covers R8.** Given the creator rewrote the logline, when the Agent re-classifies, then the creator's logline is preserved (today it is overwritten).
- AE5. **Covers R9.** Given the creator edited a shot, when they reload or switch project and back, then that shot is still creator-owned and an Agent re-run does not touch it.
- AE6. **Covers R11.** Given a shot whose emotion was Agent-derived and never hand-set, when the creator rewrites its action and commits, then the Agent updates that shot's emotion to match.
- AE7. **Covers R12.** Given a shot whose emotion the creator manually set, when the creator later edits that shot's dialogue, then the emotion stays as the creator set it.
- AE8. **Covers R13.** Given a shot, when the creator edits only its camera-angle field, then no re-tag runs and emotion/beat are unchanged.
- AE9. **Covers R15.** Given re-derivation is unavailable, when the creator edits a shot's action, then the edit still persists and labels are unchanged with no blocking error.
- AE10. **Covers R5.** Given the creator is typing in a field, when a background state update lands mid-typing, then the typed characters are not lost and focus is not stolen.

---

## Success Criteria

- In `/analysis`, the creator can change any Story Cards, Shot Production Table, story-meta, or character field, see it stick across reloads, and trust a later Agent run will not erase it.
- "Touch any field → the whole shot/card is mine" is a guarantee the creator can state in one sentence, with a visible signal of which rows are theirs.
- Manually-set labels never change on their own; Agent-derived labels stay coherent with edited narrative without the creator asking.
- A downstream planner/implementer can build without inventing the row-level ownership rule, the re-tag trigger, the sticky-label rule, or the durability requirement — the archive prototype is a working behavioral reference for all of it.

---

## Scope Boundaries

- Style / aesthetic learning from edits (edits shaping *future* generation style) — owned by `docs/brainstorms/2026-05-11-edit-context-enrichment-requirements.md`, downstream and out of scope (its `editContext.saveSnapshot` tRPC already exists; do not extend it here).
- Free-prose → structured-field parsing — deferred.
- A user-facing field-level lock UX (per-field "this cell is mine" indicators / per-field selective regeneration) — row-level is the v1 model; field granularity is a later refinement.
- Layered non-destructive regeneration (Agent writes to a separate "suggestion" layer) — downstream learning/compare track.
- Undo / redo and edit-history timeline UI.
- Changing or improving the archive prototype further — it is now only a behavioral reference, not a delivery target.
- Cross-project edit signals and multi-user / collaborative editing.

---

## Key Decisions

- **Target is the React `/analysis` product, not the prototype.** Verified root cause of "can't edit": the React views are read-only by design and the state layer has no per-field edit path. The prototype works but is not what the user ships/uses.
- **Editing and provenance are net-new in React.** The earlier "reuse existing `_userSet` machinery" decision applied only to the prototype and does NOT carry over — React has no provenance concept. The prototype's implementation (row-level ownership, story-meta/character no-overwrite guards, re-tag with sticky hand-set labels) is the behavioral spec to port.
- **Row-level mental model.** Touch any field → whole shot/card owned. Chosen over field-level (too fine a mental model for the creator) and layered-regen (overflows v1).
- **Story-meta and characters are in scope.** They are the most exposed overwrite hole and the complaint is general.
- **Re-tag policy = manual-sticky / auto-refresh, owned-row-only-write.** Recognition with zero extra clicks while strictly honoring "never overwrite the creator."
- **This is a build, not a bug fix → route to `/ce-plan`.** The behavior contract is fixed here; React architecture, component decomposition, state/persistence wiring, and tRPC changes are planning's job.

---

## Dependencies / Assumptions

- Verified: `client/src/features/analysis/views/{ShotTable,PromptDistill,TemplateDraft}.tsx` have no edit affordances; zero `contentEditable` across `client/src/features`, `client/src/archive`, `client/src/components`.
- Verified: `StoryAgentContext` holds `cards`/`storyShots` via `useState`, persists per-project to localStorage, and exposes only collection-level setters (no per-field edit mutation, no provenance).
- Verified: tRPC mutations already exist for `storyAgent.storyUpsert` and `editContext.saveSnapshot`; `normalizeShot` defines the React shot shape on load. Editing + provenance must integrate with this layer (exact wiring is planning's job).
- Verified behavioral reference: the archive prototype implements the full target contract (row-level ownership via `_userSet`, story-meta/character guards in its classify path, re-tag with sticky hand-set labels) and edits work live.
- The Agent's existing emotion/beat classification capability is reused for re-derivation; this work does not invent a new recognition model.
- Solo creator, single project — no concurrency/collaboration handling.

---

## Outstanding Questions

### Resolve Before Planning

- (None — the root cause is verified and the direction is decided: build editing into the React product.)

### Deferred to Planning

- [Affects R1, R2][Technical] Editing primitive per cell — contentEditable vs controlled input/textarea — and component decomposition across the three read-only views.
- [Affects R4, R9][Technical] Where edits and provenance persist — extend the localStorage StoryAgentContext shape, the `storyUpsert` tRPC payload, or both — for cross-device durability.
- [Affects R6, R8][Technical] Net-new provenance shape in React (per-shot/card flag + a story-meta/character marker), and where it lives in `StoryShot`/card types and the persisted payload.
- [Affects R7][Technical] Where the no-overwrite merge runs in React — inside the classify result handler in `StoryAgentContext` (the analogue of the prototype's classify merge).
- [Affects R11][Needs experimentation] Re-tag trigger pacing — on every commit vs after a settle delay — to avoid excessive model calls.
- [Affects R5][Technical] Guarding against React re-render focus loss during edit (controlled-input cursor jolts, key/identity stability).
