---
title: "feat: Editing Foundation + Recognition Handoff (Shot Production Table & Story Cards)"
type: feat
status: active
date: 2026-05-13
origin: docs/brainstorms/2026-05-13-editing-foundation-recognition-requirements.md
---

# feat: Editing Foundation + Recognition Handoff (Shot Production Table & Story Cards)

## Summary

Fix the four compounding root causes that make Shot Production Table / Story Cards uneditable, add a client-side per-field provenance record (which fields the user set by hand), change the classify-apply path from wholesale array replacement to a merge that preserves user edits, and re-derive a shot's emotion/beat after a narrative edit with manual-sticky / auto-refresh semantics — all without changing any server interface.

---

## Problem Frame

The personalization loop (standard generation → creator edits → uniquely theirs) is broken at its foundation: the creator cannot reliably modify cards/shots in the workshop-ledger UI, and any edit that does land is wiped when the Agent re-classifies. Research confirmed the "can't edit" symptom is the *sum* of four independent defects that compound, plus a hard-whitelist hydration path that would silently drop any new provenance metadata. Full situational detail, actors, and acceptance examples are in the origin requirements doc (see Sources & References).

---

## Requirements

Traces to origin `docs/brainstorms/2026-05-13-editing-foundation-recognition-requirements.md`.

- R1. Every Shot Production Table field is directly editable in the UI.
- R2. Every editable Story Cards field (card narrative content, emotion tag) is directly editable.
- R3. Editing works whether or not the story is the currently active one; non-active stories are not read-only.
- R4. An edit commits/persists on a natural boundary (blur / Enter) with no separate save action, surviving reload and server sync.
- R5. A committed edit is never discarded by UI re-render, story switching, or view toggling.
- R6. Agent re-generation/classification preserves creator-edited fields by merging, not wholesale replacement.
- R7. The system distinguishes creator-set from Agent-derived values (provenance) at the granularity needed for R6 and R10.
- R8. Provenance survives persistence and reload.
- R9. After a creator commits a narrative edit (subject/action/dialogue), the Agent re-derives that shot's emotion/beat — only for labels never hand-set.
- R10. A hand-set label is sticky: never auto-re-derived or overwritten by R6/R9 until the creator changes it.
- R11. Re-derivation is scoped to the edited shot; it does not re-tag the whole table.
- R12. Re-derivation of eligible labels is silent (no per-cell confirmation).
- R13. Re-derivation failure leaves the narrative edit persisted and the label unchanged; editing is never blocked by recognition.

**Origin actors:** A1 (Creator), A2 (Story Agent)
**Origin flows:** F1 (edit & persist a field), F2 (re-tag after narrative edit), F3 (regenerate without losing edits)
**Origin acceptance examples:** AE1 (covers R4,R5), AE2 (R3), AE3 (R6,R7), AE4 (R9), AE5 (R10), AE6 (R11), AE7 (R13)

---

## Scope Boundaries

- No changes to any server interface or contract: `/api/archive/story-agent-classify`, `/api/archive/stories`, and their request/response shapes stay exactly as-is. Provenance rides only inside the client state and the server's opaque `body` JSON blob (which the server stores verbatim without inspecting).
- No new lighter "single-shot label" endpoint, even though full-table reclassify for one shot's label is wasteful — interface change is forbidden.
- Style / aesthetic learning from edits — owned by `docs/brainstorms/2026-05-11-edit-context-enrichment-requirements.md`, downstream.
- Free-prose → structured-field parsing.
- No automated test framework / build step introduced for this static HTML file (it has none today; adding one is out of scope). Verification is browser/Preview against AE1–AE7.
- "Confirm every re-tag" and "on-demand re-tag" interaction models (rejected upstream).
- Undo/redo, edit-history timeline UI; any card interaction beyond existing drag/delete + the new inline edit.
- Recovery mode (`?dt-recover=1`) continues to clear provenance along with all `dt:storyAgent:*` state by design — not changed.

### Deferred to Follow-Up Work

- Capturing this work's learnings (contenteditable focus-loss diagnosis, provenance model, wholesale-vs-merge) via `/ce-compound` after it lands — the project has no `docs/solutions/` and these currently exist only as scattered code comments.

---

## Context & Research

### Relevant Code and Patterns

Primary file: `client/public/archive/drinking-time-workshop-ledger/index.html` (~6,097 lines, single inline `<script>`, vanilla ES, no build step, served via `sendFile` — requires hard browser reload to see changes).

- State model: globals at `index.html:2569-2593` (`storyShots` 16-key shape, `storyCards` ~20-key shape, `storyCharacters`, scalars `storyLogline/storyTheme/storyArc`, `VALID_BEATS`, `VALID_SHOT_TYPES`).
- Inline-edit pattern to mirror: `[data-edit]` + `contenteditable` spans wired at the tail of `renderScriptViewer()` (`index.html:4378-4501`, the `host.querySelectorAll('[data-edit]')` blur/Enter binding at `4394-4407`), committed in `commitInlineEdit()` (`index.html:4505-4585`). There is **no** `wireScriptViewerEvents` function — wiring is inline and re-run on every render.
- Root cause (a) active-only gating: `renderMatrix()` (`index.html:2150-2367`); editable view only attaches to `.scene-group.story-group.active.open .active-story-shotlist-slot` (`index.html:2361-2363`); non-active stories render read-only spans (`index.html:2287-2342`).
- Root cause (b) destructive re-render on commit: `commitInlineEdit → saveStoryState()` (`index.html:4584`) → unconditional `renderMatrix()` (`index.html:3040`) → `tree.innerHTML=''` (`index.html:2186`).
- Root cause (c) Story Cards non-editable: `renderStoryCards()` card body is plain `<p class="story-card-content">` / `story-card-raw`, emotion is read-only span (`index.html:4096-4111`); only drag (`setupCardDrag` `4147-4186`) + delete (`4137-4143`) wired.
- Root cause (d) collapsed CSS hides controls: `.shotlist-shots:not(.tech-on) .shot-row-head{display:none}` (`index.html:5906`), tech block hidden (`index.html:5854-5856`), default `techExpanded=false` (`index.html:2580`).
- Persistence: transparent write (`saveStoryState` `index.html:2994-3044`; `serverSync.toServerPayload/fromServerRow` `3061-3301`; server stores opaque `body` JSON at `server/_core/index.ts:41-57,427-467`). **Hard whitelist on read**: `loadStoryState()` rebuilds shots from a fixed 16-key literal (`index.html:2779-2812`) and cards from a fixed ~20-key literal (`index.html:2744-2764`); unknown fields are dropped. `classifyAllCards` rebuilds shots from a third fixed literal (`index.html:4634-4666`).
- Wholesale-overwrite vector: `classifyAllCards()` (`index.html:4587-4723`) — `storyShots = payload.shots.map(...)` (`4634-4666`), `storyCards = orderedCards` (`4685`), plus characters/arc/logline/theme/variants/boringCheck. Old arrays are still in scope inside the `payload.shots.map` callback and the `storyShots.forEach` card loop (`4670-4685`) — the only points where old↔new correspondence exists for a merge.
- Server classify (do not change): route `server/_core/index.ts:293-349`; impl/types `server/archive/storyAgent.ts` (`ShotEntry` `197-218`, `ShotListPayload` `220-242`, `synthesizeShotList` `1013-1345`). Stateless: cards in → fresh full shot list out.

### Institutional Learnings

- No `docs/solutions/` in this project; no `AGENTS.md`/`CLAUDE.md`. Prior learnings live as inline comments in the target file.
- **TDZ-on-boot is known and tolerated**: `setStage(0)` runs before the `let storyCards/storyArc` declarations; deliberate `try { renderScriptViewer(); } catch(_) {}` swallow at ~3 sites (`index.html:~1937-1938, ~2359`). Do not move state declarations, add boot-time top-level `let`s before `setStage(0)`, or reorder init without preserving this — and do not add a fourth band-aid.
- **`?dt-recover=1`** nukes all `dt:storyAgent:*` localStorage then reloads. New provenance must live within the existing story-state object (already saved under `dt:storyAgent:*`) so recovery clears it cleanly; provenance must round-trip through `hydrateFromServer`.
- Graceful-degradation shape (from the 2026-05-11 edit-context plan, React surface — pattern only, do not import its data model): recognition failure must not block the edit. Directly informs R13.
- Caution: a 2026-05-09 refactor plan proposed archiving/deleting this HTML file. Treated here as an assumption + risk (the user has actively iterated on this exact file across many sessions and just authored its requirements doc), not a blocker.

### External References

None — external research skipped: vanilla-JS contenteditable + client-side state merge in a domain with strong existing local patterns; not a high-risk surface.

---

## Key Technical Decisions

- **Decouple "persist" from "destructive full re-render."** The R5 fix is the foundation: an inline-edit commit must persist without triggering the `renderMatrix()` tree-wipe that destroys the live contenteditable node. Commits that change only a text value persist without a structural rebuild; commits that change derived visuals/structure (beat re-tint, emotion dot, character add/remove, shot delete/renumber) do a scoped update and must never destroy the node the user is actively editing. (origin Key Decision: merge/no-overwrite is meaningless if edits don't survive the commit itself.)
- **R3 via auto-activate-on-edit, not simultaneous multi-story editing.** The `#distillStage` single-shared-node model is deeply baked in; N concurrent editable views is high-risk and out of proportion. Focusing/entering a non-active story's shot area promotes that story to active (reusing `switchToStory`), after which the normal editable view applies. Satisfies AE2's observable contract ("edit accepted and persisted the same as for the active story") with minimal architectural disruption. (Inferred bet, surfaced to user at synthesis.)
- **Provenance = per-element set of user-touched field keys.** Each shot and card carries a record of which field names the creator set by hand (e.g. a `_userSet` string array). Written at commit time in `commitInlineEdit`; read by the classify-merge (R6) and the sticky-label gate (R10). Per-field granularity satisfies both "preserve any user-edited field on regenerate" and "hand-set emotion/beat is sticky."
- **Provenance survival requires extending three reconstruction whitelists.** The write/serverSync path is transparent, but `loadStoryState` (shots + cards) and `classifyAllCards` (shots) each rebuild elements from a fixed field literal. All three must carry the provenance field or it is dropped on the next reload/story-switch/project-switch/classify.
- **Re-derivation reuses the existing full classify endpoint, applies scoped.** Interface is frozen, so re-tag calls `/api/archive/story-agent-classify` (whole table in/out) but applies only the edited shot's emotion/beat from the response, and only for labels not in that shot's provenance set; everything else is preserved by the merge (R6). Behaviorally scoped (R11) even though server-side cost is a full reclassify — accepted tradeoff, recorded as risk.
- **Re-derivation pacing = per-shot debounce.** Coalesce multiple narrative-field edits to one shot (within a short settle window, fired on shot blur/settle) into a single re-derive call, rather than one model call per keystroke or per field commit. Honors R9's intent without call storms. (origin deferred question, resolved here.)
- **Re-derivation is fully silent (R12).** No post-hoc indicator in v1 (origin decision); revisit only if the creator reports surprise.
- **Verification is browser/Preview against AE1–AE7.** This static file has no test harness and the project tests only the React/server side; introducing a harness is out of scope. Each feature-bearing unit enumerates concrete browser-observable scenarios instead of unit tests.

---

## Open Questions

### Resolved During Planning

- Root cause of "can't edit" (origin deferred): resolved by research — four compounding causes (active-only gating, commit-triggered destructive re-render, Story Cards never made contenteditable, collapsed-mode CSS hiding controls). Each is addressed by a dedicated unit.
- Provenance granularity (origin deferred): resolved — per-field set of user-touched keys per shot/card.
- Re-derivation pacing (origin deferred): resolved — per-shot debounce on settle.
- Silent vs subtle indicator (origin deferred): resolved — fully silent per origin R12.

### Deferred to Implementation

- Exact debounce/settle window for re-derivation — tune against feel during implementation.
- Whether decoupling R5 is best done by removing the `renderMatrix()` call from the inline-commit save path vs. a scoped-update branch in `renderMatrix` that preserves the active node — decide once editing the real code; both must satisfy "never destroy the node the user is in."
- Exact field-key vocabulary for the provenance set (must match the `data-edit` kind names already used by `commitInlineEdit`).

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
COMMIT PATH (R4, R5, R7)
  user edits a [data-edit] field ──blur/Enter──▶ commitInlineEdit(el)
     │  write value into storyShots[idx]/storyCards[idx]
     │  record field key into element._userSet  (provenance, R7)
     ▼
  persist-only  ──▶ saveStoryRaw + serverSync.pushStory      (NO destructive renderMatrix)
     │
     └─ if field is narrative (subject/action/dialogue) ─▶ schedule per-shot debounced re-derive (R9)

RE-DERIVE (R9–R13)         RECLASSIFY MERGE (R6, R10)
  settle window elapses      classifyAllCards receives payload
     ▼                          ▼
  call /story-agent-classify   for each new shot:
     ▼                            keep old field IF key ∈ old._userSet
  take ONLY edited shot's          else take model value
  emotion/beat                   carry _userSet forward
     ▼                          (same gate for card emotion)
  apply only if key ∉ _userSet
  fail → leave edit + label as-is (R13)

PERSISTENCE WHITELISTS (R8) — _userSet must be copied in all three:
  loadStoryState shots literal · loadStoryState cards literal · classifyAllCards shots map
```

---

## Implementation Units

### U1. Decouple persist from destructive re-render

**Goal:** An inline-edit commit persists without the `renderMatrix()` tree-wipe destroying the live contenteditable node; the node the user is editing is never torn down by its own commit. Foundation for all later units (they all commit/persist).

**Requirements:** R4, R5; F1; AE1

**Dependencies:** None

**Files:**
- Modify: `client/public/archive/drinking-time-workshop-ledger/index.html` (`commitInlineEdit` ~4505-4585; `saveStoryState` ~2994-3044; the `renderMatrix()` call at ~3040; render call-graph callers `switchToStory`/`classifyAllCards`/boot that legitimately need a rebuild)

**Approach:**
- Separate the persistence side effect from the structural rebuild side effect. The inline-commit path must persist (localStorage + `serverSync.pushStory`) and re-flow only what genuinely changed, without `tree.innerHTML=''`.
- Preserve rebuilds for callers that need them (story switch, classify, boot) by invoking the structural render explicitly there rather than implicitly through every save.
- Commits with derived visuals (beat re-tint, emotion dot recolor) get a scoped DOM update, not a full wipe; never re-parent/destroy `#distillStage` while a descendant is focused.
- Honor the TDZ boot ordering — do not move state declarations or reorder init.

**Patterns to follow:** existing `commitInlineEdit` kind-switch; existing scoped re-tint logic already present for emotion dot / beat.

**Execution note:** Hard-reload the browser to verify (no HMR for this file). Preserve the `try{renderScriptViewer()}catch(_){}` boot swallow sites.

**Test scenarios (browser/Preview):**
- Happy path / Covers AE1: edit a shot's dialogue, click away → new text shown, persists after hard reload, not reverted.
- Edge: edit field A, then immediately edit field B in the same shot → both hold; B's edit is not lost to A's commit re-render.
- Edge: edit a field whose commit changes a derived visual (beat select) → row re-tints without losing the edit or focus context.
- Error/regression guard: rapid sequential edits across 3 shots → every edit persists; no edit reverts.

**Verification:** Editing no longer "bounces"; committed values survive hard reload; no full table flash on each keystroke-commit.

### U2. Make Story Cards fields editable

**Goal:** Card narrative content and the card emotion tag become inline-editable in IDEA POOL, matching the shot-field pattern, committing+persisting through the same path.

**Requirements:** R2, R4; F1; AE1

**Dependencies:** U1

**Files:**
- Modify: `client/public/archive/drinking-time-workshop-ledger/index.html` (`renderStoryCards` ~4059-4144; `commitInlineEdit` kind-switch ~4505-4585; card event wiring near render tail)

**Approach:**
- Add `contenteditable` + `data-edit` (new card-content / card-emotion kinds with `data-id`/`data-idx`) to the card body and emotion in `renderStoryCards`, mirroring the shot-field markup.
- Extend `commitInlineEdit` to handle the new kinds → write into the matching `storyCards[idx]` and record provenance (U4 wires the provenance write; U2 just adds the kinds + binding).
- Keep existing drag/delete intact; ensure inline edit does not start a drag.

**Patterns to follow:** shot `data-edit` spans + `commitInlineEdit` branches; `escapeHtml` usage in render templates.

**Test scenarios (browser/Preview):**
- Happy path: edit a card's content text, blur → persists after reload.
- Happy path: edit a card's emotion tag → persists.
- Edge: starting an edit on a card does not trigger card drag/reorder; delete button still works.
- Edge: empty card content edit → handled like empty shot fields (no crash, placeholder behavior consistent).

**Verification:** Card body + emotion are editable and durable, with drag/delete unaffected.

### U3. Make non-active stories editable (auto-activate-on-edit)

**Goal:** Editing a shot field in a non-active story is accepted and persisted; the story promotes to active so the existing editable view applies. Non-active stories are no longer read-only spans.

**Requirements:** R3; F1; AE2

**Dependencies:** U1

**Files:**
- Modify: `client/public/archive/drinking-time-workshop-ledger/index.html` (`renderMatrix` non-active branch ~2287-2342 and active-slot logic ~2361-2365; `switchToStory` ~2920-2936)

**Approach:**
- Replace read-only span rendering for non-active stories with an affordance that, on intent-to-edit (focus/click into the shot area), calls `switchToStory(thatId)` then lands the user in the now-active editable view at the corresponding field.
- Reuse the single `#distillStage` model — do not attempt N concurrent editable views.
- Ensure the promote→render path does not lose the click target (focus the intended field after activation where feasible; acceptable fallback: story becomes active+expanded and the field is immediately editable).

**Patterns to follow:** existing `switchToStory` + active-slot `appendChild` mechanism; `.scene-group.story-group` open/active class logic.

**Test scenarios (browser/Preview):**
- Happy path / Covers AE2: with story B non-active, click a shot field in B and edit → B becomes active, edit accepted, persists after reload identical to active-story edits.
- Edge: switching via edit does not corrupt A's unsaved state (A's last commit already persisted per U1).
- Edge: non-active story groups still render their summary rows; only the edit interaction promotes.

**Verification:** No story is read-only; editing any story's shots works and persists.

### U4. Provenance: record user-touched fields on commit + survive persistence

**Goal:** Each shot/card carries a per-field set of creator-set keys, written on commit, surviving reload / story-switch / project-switch / server round-trip / classify.

**Requirements:** R7, R8; F1, F3

**Dependencies:** U1, U2

**Files:**
- Modify: `client/public/archive/drinking-time-workshop-ledger/index.html` (`commitInlineEdit` ~4505-4585 to record the key; `loadStoryState` shot literal ~2779-2812 and card literal ~2744-2764 to carry it; `classifyAllCards` shot map ~4634-4666 to carry it)

**Approach:**
- On every `commitInlineEdit` that changes a value, add the field's kind/key to that element's provenance set (shots and cards).
- Extend all three reconstruction whitelists to copy the provenance field through (sanitize to an array of known string keys; default empty).
- Provenance lives inside the existing story-state object (already under `dt:storyAgent:*` and inside the server `body` blob) — no new storage key, recovery still clears it by design.
- Preserve TDZ boot ordering; do not introduce new boot-time top-level `let`s ahead of `setStage(0)`.

**Patterns to follow:** the fixed field-literal reconstruction style in `loadStoryState`; `Array.isArray` guards already used for `emotionOptions`/`themeHints`.

**Test scenarios (browser/Preview):**
- Happy path: edit a shot's emotion → reload → that shot's provenance still marks emotion as user-set (verified indirectly via U5/U6 stickiness, and directly via devtools state inspection).
- Edge: a never-edited shot has empty provenance after reload.
- Edge: project-switch and story-switch both preserve provenance (not just hard reload).
- Integration: provenance round-trips through `serverSync` (simulate hydrate-from-server path).

**Verification:** A creator-set field stays marked creator-set across every reconstruction path.

### U5. Merge-not-replace on classify

**Goal:** `classifyAllCards` preserves creator-set shot/card fields (per U4 provenance) instead of wholesale array replacement.

**Requirements:** R6, R10; F3; AE3

**Dependencies:** U4

**Files:**
- Modify: `client/public/archive/drinking-time-workshop-ledger/index.html` (`classifyAllCards` shot map ~4634-4666 and card reorder loop ~4670-4685)

**Approach:**
- At the `payload.shots.map` callback (old `storyShots` still in scope, correspondence via `sourceCardContent`/`cardsByContent`): for each field, keep the old value when its key is in that shot's provenance set; otherwise take the model value. Carry the provenance set forward onto the merged shot.
- Apply the same gate to card emotion in the reorder loop (`matched.emotion` overwrite) — do not overwrite a user-set card emotion.
- Leave non-provenanced fields fully model-driven (unchanged behavior).

**Patterns to follow:** existing `cardsByContent` correspondence map; existing `matched.emotion/order` assignment site.

**Test scenarios (browser/Preview):**
- Happy path / Covers AE3: edit several shots, trigger reclassify → edited fields exactly as left; non-edited fields refreshed by model.
- Edge / Covers AE5: hand-set a shot emotion, reclassify → emotion unchanged.
- Edge: a user-set card emotion survives reclassify reorder.
- Edge: a shot with no provenance is fully refreshed (no accidental freezing).

**Verification:** Reclassify never erases a creator edit; untouched fields still benefit from regeneration.

### U6. Re-derive emotion/beat after narrative edit (sticky-aware, silent, fail-safe)

**Goal:** After a narrative-field commit on a shot, debounced per-shot, re-derive that shot's emotion/beat via the existing classify endpoint, applying only to non-sticky labels, silently, never blocking on failure.

**Requirements:** R9, R10, R11, R12, R13; F2; AE4, AE6, AE7

**Dependencies:** U4, U5, U1

**Files:**
- Modify: `client/public/archive/drinking-time-workshop-ledger/index.html` (commit path narrative-field branch from U1; a per-shot debounce scheduler; the existing `fetch('/api/archive/story-agent-classify')` call site ~4598-4626 reused; apply-scoped logic distinct from `classifyAllCards`' full apply)

**Approach:**
- On commit of `shot-subject`/`shot-action`/`shot-dialogue`, schedule a per-shot debounced re-derive keyed by shot identity; coalesce multiple narrative edits to one shot into one call fired on settle.
- Reuse the frozen `/api/archive/story-agent-classify` request shape; from the response take only the edited shot's `emotion`/`beat`.
- Apply each only if its key is NOT in that shot's provenance set (sticky gate, R10). Applying a derived label does not add it to provenance (it remains Agent-derived, refreshable).
- Silent: no toast/confirmation (R12). Scoped: only that shot's labels change (R11) — everything else preserved by U5 merge semantics.
- On any failure (no API key/network/parse): leave the narrative edit persisted and labels unchanged; never block editing (R13). Reuse the graceful-degradation shape (pattern only).

**Patterns to follow:** existing classify fetch + `payload.error` handling at ~4625; existing per-shot index/`sourceCardContent` correspondence.

**Test scenarios (browser/Preview):**
- Happy path / Covers AE4: shot emotion was Agent-derived (no provenance), rewrite its action → emotion updates to match.
- Edge / Covers AE5: hand-set emotion, then edit dialogue → emotion stays.
- Edge / Covers AE6: edit shot 4's subject in a 10-shot table → only shot 4's labels reconsidered; others untouched.
- Error / Covers AE7: classify unavailable → action edit still persists, labels unchanged, no blocking error, editing continues.
- Edge: three quick narrative edits to one shot → one coalesced re-derive call, not three.

**Verification:** Narrative edits keep labels coherent without erasing hand-set labels; failures degrade silently.

---

## System-Wide Impact

- **Interaction graph:** `commitInlineEdit` is the hub — touched by U1/U2/U4/U6. The render call-graph (`saveStoryState → renderMatrix`, boot `storyAgentInit`, `switchToStory`, `classifyAllCards`) must keep working for non-edit callers after U1 decouples the edit path.
- **Error propagation:** Re-derivation failure (U6) must be contained — never propagate to block the commit or the UI (R13).
- **State lifecycle risks:** Provenance must survive all four reconstruction events (reload, story-switch, project-switch, classify). Torn-write caution: persistence has no atomic guarantee; merge logic must be deterministic so a partial state is still recoverable via recovery mode.
- **API surface parity:** None changed by design. The same provenance gate applies in two apply paths (U5 full classify, U6 scoped re-derive) — keep them consistent.
- **Unchanged invariants:** Server endpoints/contracts, the `#distillStage` single-node model, recovery mode semantics, TDZ boot ordering — explicitly not changed.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Decoupling re-render (U1) regresses callers that legitimately need a rebuild | Make rebuild explicit at those callers; browser-verify story-switch/classify/boot still render fully |
| `#distillStage` single-node model makes U3 fragile | Auto-activate-on-edit reuses existing `switchToStory`; no concurrent-view rewrite |
| Provenance silently dropped by a missed whitelist | All three reconstruction sites enumerated in U4; verify across reload + story-switch + project-switch + hydrate |
| Full reclassify per narrative edit is slow/costly (interface frozen) | Per-shot debounce + coalesce (U6); accepted tradeoff, no interface change |
| TDZ boot fragility if state decls move | U1/U4 explicitly preserve boot ordering and the swallow sites; no new pre-`setStage(0)` top-level `let` |
| File flagged for archival by a 2026-05-09 plan | Treated as assumption+risk; user has actively iterated on this file and authored its requirements doc — proceeding |
| No automated test harness | Per-unit browser/Preview scenarios mapped to AE1–AE7; harness out of scope |

---

## Documentation / Operational Notes

- After landing, capture learnings via `/ce-compound` (no `docs/solutions/` exists; institutional memory is currently only inline comments).
- No rollout/monitoring/migration concerns — client-only behavior, additive provenance inside existing persisted state, no schema/interface change.

---

## Sources & References

- **Origin document:** `docs/brainstorms/2026-05-13-editing-foundation-recognition-requirements.md`
- Related (downstream, out of scope): `docs/brainstorms/2026-05-11-edit-context-enrichment-requirements.md`, `docs/plans/2026-05-11-001-feat-edit-context-enrichment-plan.md`
- Primary work file: `client/public/archive/drinking-time-workshop-ledger/index.html`
- Server (do not change): `server/_core/index.ts:293-349`, `server/archive/storyAgent.ts:197-242,1013-1345`
