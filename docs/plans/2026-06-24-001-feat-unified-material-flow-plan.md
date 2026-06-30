---
title: "feat: Unify image, video, editing, and shot derivation flow"
type: feat
status: completed
date: 2026-06-24
completed_at: 2026-06-28
origin: docs/brainstorms/2026-06-24-001-unified-image-video-editing-material-flow-requirements.md
---

# feat: Unify image, video, editing, and shot derivation flow

## Summary

The shot design table, Storyboard, Animatic, and Xiaozhuo now share one
story-scoped material projection. Images become current only after explicit
selection. Videos remain preview takes until explicit adoption. Animatic owns a
versioned timeline and resolves each shot to an adopted, non-stale video or the
current main image. Derived shots are inserted and undone with story and
timeline concurrency checks.

This plan supersedes the earlier conclusions that a successful video
automatically becomes current, timeline state may remain local, and frame
derivation should be deferred.

## Requirements

- R1. Read current image, image history, adopted video, video history, stale
  state, and timeline state from one `StoryMaterialState`.
- R2. Use `storyId + userId + stableShotId` for material ownership; display shot
  numbers are not identity.
- R3. Generate four independent image candidates; no candidate becomes current
  before explicit selection.
- R4. Selecting a main image is atomic, unique per shot, and clears the prior
  active video adoption while retaining old takes.
- R5. Compose image prompts in a deterministic priority order: current image,
  adjacent images, confirmed person/scene/object/composition references,
  narrative style, and art style.
- R6. Generate video in Storyboard from only the selected current image.
- R7. Persist the submitted prompt, motion, provider/model, duration,
  neighboring references, task ID, generation time, and result-selection rule.
- R8. A successful video is previewable but does not become current until
  `adoptVideoTake`.
- R9. Adopting a take creates a usable range from zero to the smaller of planned
  duration and video duration.
- R10. Animatic resolves an adopted, available, non-stale video first and the
  current image second.
- R11. Persist timeline inclusion, order, duration, crop, zoom, and pan in a
  versioned story document.
- R12. Preserve timeline position and transforms when a video replaces an image
  placeholder.
- R13. Keep Storyboard, Animatic, and the shot design table synchronized to the
  same ordered shot set and selected shot.
- R14. Expose current and historical images, unadopted/stale/failed videos, and
  adoption actions in the Animatic material drawer.
- R15. Capture full and cropped video frames from controlled same-origin media.
- R16. Analyze the full frame and selected crop, then generate four derived
  image candidates.
- R17. Confirm a derived shot by atomically writing the story, stable identity,
  selected image, timeline insertion, and operation record.
- R18. Make repeated derived-shot confirmation idempotent.
- R19. Undo a derived-shot operation only when story and timeline versions have
  not been superseded, and restore all state atomically.
- R20. Keep ordinary tests mocked; paid 302 smoke tests remain explicit.

## Core Architecture

- `shared/storyMaterial.ts` defines the public story material and timeline
  contracts.
- `server/services/storyMaterials.ts` projects the story-level material fact.
- `CreationEditorContext` combines the projection with editable story fields;
  it does not infer an unadopted video as current.
- `video_timeline_selections` remains the explicit video-adoption fact.
- `story_timelines` persists ordered, included timeline items and normalized
  visual transforms behind optimistic version checks.
- `shot_derivation_drafts` and `story_operations` persist frame derivation and
  reversible confirmations.
- `/api/videos/:file` serves owned, same-origin video assets with seek/range
  support through Express `sendFile`.

## Public Interfaces

- Query: `storyAgent.storyMaterialState(storyId)`.
- Images: candidate generation and `creationAgent.promoteStoryImage`.
- Videos: generate/refresh take, `adoptVideoTake`, and
  `clearVideoTimelineSegment`.
- Timeline: `creationAgent.updateStoryTimeline` with `expectedVersion`.
- Derivation: `createDerivationDraft`, `analyzeDerivationDraft`,
  `generateDerivedCandidates`, `confirmDerivedShot`, and
  `undoStoryOperation`.
- Selection context includes unadopted video, stale video, timeline material,
  and derivation draft states.

## Implementation Units

### U1. Reference Taxonomy and Xiaozhuo Intake

**Status:** Completed.

- Supports person, scene, object, composition, and local reference roles.
- References require confirmation before influencing generation.
- Existing character-anchor data remains compatible.

### U2. Image Current-Main Contract

**Status:** Completed.

- New candidates default to `isCurrent=false`.
- Promotion writes an explicit selection and enforces one current image in a
  transaction.
- Promotion clears the adopted video relation for the shot; takes remain in
  history and become stale by `sourceImageId`.
- Legacy stories retain one compatibility main image only when no explicit
  signal exists.

### U3. Reference Composer and Prompt Pipeline

**Status:** Completed.

- A deterministic compiler owns hard constraints and style continuity.
- Optional 302 semantic enrichment cannot remove required constraints.
- Scene analysis, character field compatibility, and test isolation were
  repaired.
- The single-frame rule forbids grids, panels, insets, thumbnails, and
  multi-moment compositions.

### U4. Storyboard Video Preflight and Adoption

**Status:** Completed.

- Storyboard exposes the current frame, editable video prompt, motion control,
  continuity references, take preview, parameter snapshot, and explicit
  adoption.
- MJ-Video receives only the selected main image.
- Multiple provider results use the first valid URL and record that rule.
- Failed and historical takes do not replace usable material.

### U5. Animatic Material Consumer and Persistent Timeline

**Status:** Completed.

- Animatic uses an adopted, non-stale video or the current image fallback.
- Timeline inclusion, order, duration, and transform data are persisted with
  optimistic concurrency.
- Add, remove, play-one, play-all, and range selection survive refetch.
- Responsive panel widths, fixed control zones, and horizontal timeline rails
  prevent the previous overlap and narrow-screen blank strip.

### U6. Shared Selection and Xiaozhuo Actions

**Status:** Completed for the shared UI selection contract.

- Storyboard, Animatic, and the shot design table use the same merged shot order.
- Persisted derived shots are merged by stable identity, retain story order, and
  receive unique display numbers.
- Image display follows `shotIdentity`, so inserting a shot does not move an old
  image onto a neighboring shot.
- Xiaozhuo selection types cover image, video, timeline, and derivation state;
  writes still require explicit user confirmation.

### U7. Animatic Material Drawer

**Status:** Completed.

- Supports current-shot and all-material scopes.
- Previews current/history images plus unadopted, historical, stale, and failed
  video takes.
- Same-shot assets can be promoted or adopted; material from another shot is
  not silently reassigned.

### U8. Frame Derivation and Atomic Insert/Undo

**Status:** Completed.

- Reuses frame stepping, zoom, pan, and rectangle selection in Animatic.
- Controlled video copies enable canvas frame capture; failed copies remain
  previewable but cannot be used for derivation.
- 302 analyzes the full frame and crop and generates four candidates.
- Confirmation is transactional and idempotent.
- Undo uses a single MySQL transaction; local persistence performs one write
  with in-memory rollback on failure.

## Data Migration and Compatibility

- Migration `0007_unified_material_flow.sql` creates story timelines,
  derivation drafts, and story operation records.
- Existing explicit image signals remain authoritative. Signal-free legacy
  rows receive a compatibility main image without a bulk rewrite.
- Existing video timeline selections remain adopted; available takes without a
  selection remain preview-only.
- Stories without a timeline lazily project their story order and persist on
  first edit.
- MySQL mutations use row locks/version checks. Local mode validates first,
  mutates an in-memory snapshot, and persists once.

## Verification

- TypeScript: `tsc --noEmit`.
- Unit/integration suite: 91 files, 593 tests passing, including atomic undo,
  idempotent confirmation, derived-shot ordering, and identity-based image
  placement assertions.
- Production build: `vite build`.
- Browser acceptance at `http://localhost:3000/`:
  - Storyboard and Animatic each display 14 unique shot numbers.
  - Selecting SH01 in Storyboard updates the Animatic header to SH01.
  - The material drawer fits desktop and 390px-wide viewports.
  - No browser console errors or warnings were emitted.
- Paid 302 smoke generation was not repeated during final verification to avoid
  an unrequested charge.

## Post-Deploy Monitoring and Validation

- Watch logs for `时间轴版本已更新`, `派生后已有新的编辑`,
  `视频托管失败`, `故事不存在或无权操作`, and provider task failures.
- Verify that each shot has at most one explicit current image and at most one
  video timeline selection.
- Healthy signal: SH05/SH06 and derived shots retain the same image/video in all
  three panels after refresh.
- Failure signal: duplicate display numbers, an adopted stale take, or story and
  timeline revisions diverging after confirm/undo.
- Rollback trigger: any partial derived-shot write or cross-user material read.
  Disable derivation routes first; keep existing image/video history intact.
- Validation window: first 24 hours after deployment, owned by the feature
  operator.

## Scope Boundaries

- No `.env`, provider keys, or billing settings were changed.
- No multi-track audio, transition renderer, physical MP4 crop, final export,
  or batch whole-story video generation is included.
