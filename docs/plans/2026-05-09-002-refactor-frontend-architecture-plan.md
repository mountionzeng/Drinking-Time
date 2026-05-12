---
title: "refactor: Frontend Architecture — Feature Modules, Hook Splitting, tRPC Unification"
type: refactor
status: active
date: 2026-05-09
origin: docs/brainstorms/frontend-architecture-refactor-requirements.md
---

# refactor: Frontend Architecture — Feature Modules, Hook Splitting, tRPC Unification

## Summary

Restructure the frontend from a flat `components/` directory into feature-grouped modules (`features/analysis/`, `features/storyAgent/`, `features/nayin/`), split the monolithic `useAnalysisWorkspace` hook into four focused hooks, migrate Story Agent's six `fetch()` endpoints to tRPC procedures wrapping the existing archive logic, lift direct tRPC calls out of DropZone and Timeline into the hook layer, and archive orphaned components — all executed as eight sequential implementation units ordered by dependency: dead code first, then file moves, then behavioral refactors.

---

## Problem Frame

The `client/src/components/` directory holds 22 business components in a flat folder alongside 50+ shadcn/ui primitives, with no signal about which files belong to which feature. The central state hook returns 28 values covering four unrelated concerns. Story Agent uses raw `fetch()` while the rest of the app uses tRPC. Several components are orphaned. See origin document for full problem analysis (see origin: `docs/brainstorms/frontend-architecture-refactor-requirements.md`).

---

## Requirements

- R1. Business components grouped by feature module, not flat `components/`
- R2. Each feature module has its own views, hooks, config, types subdirectories as needed
- R3. Top-level `components/` contains only shared, feature-agnostic components and `ui/` primitives
- R4. Orphaned components moved to `client/src/archive/`, not deleted
- R5. Each module directory has a clear single responsibility
- R6. `useAnalysisWorkspace` split into multiple focused hooks, each owning one concern
- R7. Split hooks compose cleanly — no single hook returns more than ~10 values
- R8. Panel collapse state and active input tab persist to localStorage across reloads
- R9. Sticky workspace-stage behavior preserved (once 'workspace', stays until reload)
- R10. Story Agent's `fetch()` calls migrated to tRPC router endpoints
- R11. tRPC migration preserves identical request/response shapes — AI backend logic not modified
- R12. `StoryAgentContext` uses `trpc.storyAgent.*` mutations/queries instead of raw `fetch()`
- R13. Archive fetch endpoints may be removed after tRPC migration is verified
- R14. `DropZone` no longer calls tRPC mutations directly — lifted to hook layer
- R15. `Timeline` no longer calls tRPC mutations directly — lifted to hook layer
- R16. After lifting, DropZone and Timeline are pure "props-in, UI-out" display components
- R17. `ThemeContext` moved to archive
- R18. `mockData.ts` split: active configs/types to feature modules; unused mock arrays archived
- R19. Orphaned components (`ManusDialog`, `Map`, `DashboardLayout`, `DashboardLayoutSkeleton`, `ProfileRailDrawer`, `TweaksDock`, `StageAtlas`) moved to archive

**Origin acceptance examples:**
- AE1 (covers R1, R3): `client/src/components/` shows only shared utilities and `ui/`
- AE2 (covers R6, R7): `AnalysisWorkspace` calls focused hooks independently, none returns >10 values
- AE3 (covers R10, R12): StoryAgentChat requests go through `trpc.storyAgent.chat.useMutation()`
- AE4 (covers R14, R16): DropZone calls an `onUpload` prop callback, does not import tRPC

---

## Scope Boundaries

- AI prompt strategy, conversation logic, and analysis engine algorithms are not modified
- UI/UX design, layout, visual styling, and component appearance are not changed
- Mobile responsive adaptation is deferred
- No new features — purely organizational and structural
- Backend tRPC router additions are minimal wrappers around existing archive logic

### Deferred to Follow-Up Work

- Remove archive REST endpoints from `server/_core/index.ts` after tRPC migration is verified stable: future iteration
- Create `docs/solutions/` learnings from this refactor: future iteration
- Move `TopBar.tsx` into a `features/shell/` module if more app-chrome components emerge: future iteration

---

## Context & Research

### Relevant Code and Patterns

- `client/src/features/analysis/` — established feature module pattern with `config/`, `containers/`, `hooks/`, `views/`, `types.ts`
- `client/src/features/storyAgent/StoryAgentContext.tsx` — 975-line context using 6 raw `fetch()` calls to archive REST endpoints
- `server/archive/storyAgent.ts` — 1121-line module with `replyFromStoryAgent`, `synthesizeShotList`, `summarizeHistory`
- `server/routers.ts` — existing tRPC router tree; `storyAgent` sub-router has simplified procedures that need upgrading
- `docs/analysis-architecture.md` — four-layer model (App > Business > Platform > External); Platform layer rule: "props-in, UI-out"
- `client/src/features/analysis/hooks/useAnalysisWorkspace.ts` — 209 lines, 28 return values

### Institutional Learnings

- No `docs/solutions/` exists yet. Architectural conventions documented in `docs/analysis-architecture.md`.
- Prior plan `docs/plans/2026-05-09-001-refactor-analysis-page-architecture-plan.md` (completed) established the `features/analysis/` module pattern, CSS display toggling for tabs, sticky workspace stage, and StoryAgentProvider mounting order.

---

## Key Technical Decisions

- **Wrap archive functions, don't rewrite**: New tRPC procedures for Story Agent will import and call the existing `server/archive/storyAgent.ts` functions (`replyFromStoryAgent`, `synthesizeShotList`, `summarizeHistory`). The archive functions contain sophisticated AI prompt logic that must not be duplicated or simplified. The existing simplified `storyAgent.chat` and `storyAgent.generateScript` tRPC procedures will be replaced with the richer archive versions.

- **Four-hook split for useAnalysisWorkspace**: Split into `useProjectData` (~6 values: project selection, queries, auto-create), `useAnalysisOrchestration` (~6 values: run/complete, analysisActive, mutations), `useTweaks` (~8 values: grain, jitter, illustrationSize, autoCycle + CSS side effects), `usePanelState` (~8 values: timelineOpen, selectedStage, activeInputTab, workspaceStageSticky). Each hook is independently callable from the workspace view.

- **Lift mutations as prop callbacks, not custom hooks**: Per origin key decision — `DropZone` gets `onUploadFiles` callback, `Timeline` gets `onPin`/`onExclude` callbacks. No per-component mutation hooks for single-use sites.

- **ThemeContext removal strategy**: Remove `<ThemeProvider>` from `AppProviders.tsx`, add `class="dark"` to `<html>` in `index.html`, archive `ThemeContext.tsx`. The provider is hardcoded to dark mode and never toggles.

- **TopBar stays in `components/`**: It's app-level page chrome, not analysis-specific or story-agent-specific. It receives all feature-specific state as props.

- **Story Agent tRPC router expansion**: Replace the existing 2-procedure `storyAgent` sub-router with 7 procedures: `chat`, `classify`, `summarize`, `storyList`, `storyGet`, `storyUpsert`, `storyDelete` — matching the 6 archive REST endpoints plus the summarize function.

---

## Open Questions

### Resolved During Planning

- **Exact directory tree**: Each feature module follows `features/analysis/` pattern — `views/`, `hooks/`, `config/`, `types.ts` as needed. Not every module needs every subdirectory.
- **Hook split boundaries**: Four hooks with clear ownership — see Key Technical Decisions.
- **Story Agent fetch endpoint shapes**: Fully mapped — 6 REST endpoints with documented request/response shapes. All map cleanly to tRPC mutations/queries.
- **mockData.ts type placement**: `ShotStatus`, `Priority`, `SourceType` already re-exported from `features/analysis/types.ts`. `STATUS_CONFIG` and `SOURCE_TYPE_CONFIG` move to `features/analysis/config/statusConfig.ts`. `PRIORITY_CONFIG` is unused — archived.

### Deferred to Implementation

- Exact Zod schema definitions for new Story Agent tRPC procedures — will be derived from the archive function parameter types at implementation time
- Whether `StoryAgentContext` localStorage persistence keys need migration when switching from fetch to tRPC — likely no, but verify at implementation time

---

## Output Structure

```
client/src/
  archive/                          # NEW — dead code holding area
    DashboardLayout.tsx
    DashboardLayoutSkeleton.tsx
    ManusDialog.tsx
    Map.tsx
    ProfileRailDrawer.tsx
    StageAtlas.tsx
    ThemeContext.tsx
    TweaksDock.tsx
    mockData.archive.ts             # dead exports from mockData.ts
  components/
    ErrorBoundary.tsx                # STAYS — shared
    TopBar.tsx                       # STAYS — shared page chrome
    ui/                              # STAYS — shadcn primitives
  features/
    analysis/
      config/
        stageCopy.ts                 # existing
        workshopCopy.ts              # existing
        statusConfig.ts              # NEW — STATUS_CONFIG, SOURCE_TYPE_CONFIG, PRIORITY_CONFIG
      containers/
        AnalysisTimelineDrawer.tsx   # existing
      hooks/
        useProjectData.ts            # NEW — split from useAnalysisWorkspace
        useAnalysisOrchestration.ts  # NEW — split from useAnalysisWorkspace
        useTweaks.ts                 # NEW — split from useAnalysisWorkspace
        usePanelState.ts             # NEW — split from useAnalysisWorkspace
      types.ts                       # existing (absorbs active mockData types)
      views/
        AnalysisWorkspace.tsx        # existing (updated to use split hooks)
        GuidedLanding.tsx            # existing
        WorkspaceLayout.tsx          # existing
        WorkspaceStageRouter.tsx     # existing
        DropZone.tsx                 # MOVED from components/
        Timeline.tsx                 # MOVED from components/
        ShotTable.tsx                # MOVED from components/
        TemplateDraft.tsx            # MOVED from components/
        PromptDistill.tsx            # MOVED from components/
        ShotStageIllustration.tsx    # MOVED from components/
    storyAgent/
      StoryAgentContext.tsx          # existing (updated to use tRPC)
      types.ts                       # existing
      views/                         # NEW subdirectory
        StoryAgentChat.tsx           # MOVED from components/
        StoryCardsBoard.tsx          # MOVED from components/
        ScriptViewer.tsx             # MOVED from components/
    nayin/                           # NEW module
      NayinContext.tsx               # MOVED from contexts/
      nayin.ts                       # MOVED from lib/
      favicon.ts                     # MOVED from lib/
      views/
        BeverageAmbience.tsx         # MOVED from components/
        BeverageTransition.tsx       # MOVED from components/
        BeverageTransitionOverlay.tsx # MOVED from components/
```

---

## Implementation Units

### U1. Archive Dead Code and Split mockData.ts

**Goal:** Remove noise from the active codebase by archiving orphaned components, dead ThemeContext, and unused mockData exports. Extract active mockData configs to their proper feature module locations.

**Requirements:** R4, R17, R18, R19

**Dependencies:** None

**Files:**
- Create: `client/src/archive/` directory
- Move to archive: `client/src/components/ManusDialog.tsx`, `Map.tsx`, `DashboardLayout.tsx`, `DashboardLayoutSkeleton.tsx`, `ProfileRailDrawer.tsx`, `TweaksDock.tsx`, `StageAtlas.tsx`
- Move to archive: `client/src/contexts/ThemeContext.tsx`
- Create: `client/src/archive/mockData.archive.ts` (dead exports: `MOCK_SHOTS`, `MOCK_FRAGMENTS`, `TEMPLATE_DRAFT`, `ReferenceFragment`, `ShotProductionRow`, `IntentType`, `PRIORITY_CONFIG`)
- Create: `client/src/features/analysis/config/statusConfig.ts` (active exports: `STATUS_CONFIG`, `SOURCE_TYPE_CONFIG`)
- Modify: `client/src/lib/mockData.ts` — reduce to only re-exporting active types (`ShotStatus`, `Priority`, `SourceType`) or remove entirely if all consumers updated
- Modify: `client/src/app/providers/AppProviders.tsx` — remove `<ThemeProvider>` wrapper
- Modify: `index.html` — add `class="dark"` to `<html>` element
- Modify: `client/src/pages/ComponentShowcase.tsx` — remove `useTheme` import

**Approach:**
- Move files physically, do not delete
- For ThemeContext removal: verify `class="dark"` on `<html>` preserves current dark-mode styling. The ThemeProvider was hardcoded to `defaultTheme="dark"` with no toggle capability.
- For mockData split: `STATUS_CONFIG` is imported by `ShotTable.tsx`, `SOURCE_TYPE_CONFIG` by `Timeline.tsx`. Update their import paths to `@/features/analysis/config/statusConfig`. The type aliases (`ShotStatus`, `Priority`, `SourceType`) are already re-exported from `features/analysis/types.ts`.
- Check `sonner.tsx` — it imports `useTheme` from `next-themes`, not from ThemeContext, so it's unaffected.

**Patterns to follow:**
- Existing `client/public/archive/` pattern for archival

**Test scenarios:**
- Happy path: TypeScript compilation passes with zero errors after all moves and import updates
- Happy path: Vite dev server starts without warnings about missing modules
- Edge case: `ComponentShowcase.tsx` renders without ThemeContext — verify no runtime error
- Integration: Dark mode styling preserved — `<html class="dark">` produces same visual result as ThemeProvider

**Verification:**
- `client/src/components/` no longer contains any of the 7 orphaned components
- `client/src/contexts/ThemeContext.tsx` no longer exists (archived)
- `client/src/archive/` contains all moved files
- All imports resolve; build succeeds

---

### U2. Create features/nayin/ Module

**Goal:** Move NayinContext and its related utilities and Beverage components into a self-contained `features/nayin/` module.

**Requirements:** R1, R2, R3, R5

**Dependencies:** U1

**Files:**
- Create: `client/src/features/nayin/` directory
- Move: `client/src/contexts/NayinContext.tsx` → `client/src/features/nayin/NayinContext.tsx`
- Move: `client/src/lib/nayin.ts` → `client/src/features/nayin/nayin.ts`
- Move: `client/src/lib/favicon.ts` → `client/src/features/nayin/favicon.ts`
- Create: `client/src/features/nayin/views/` directory
- Move: `client/src/components/BeverageAmbience.tsx` → `client/src/features/nayin/views/BeverageAmbience.tsx`
- Move: `client/src/components/BeverageTransition.tsx` → `client/src/features/nayin/views/BeverageTransition.tsx`
- Move: `client/src/components/BeverageTransitionOverlay.tsx` → `client/src/features/nayin/views/BeverageTransitionOverlay.tsx`
- Modify: All files importing from `@/contexts/NayinContext` — update to `@/features/nayin/NayinContext`
- Modify: All files importing from `@/lib/nayin` — update to `@/features/nayin/nayin`
- Modify: All files importing from `@/lib/favicon` — update to `@/features/nayin/favicon`

**Approach:**
- NayinContext is imported by many components (TopBar, DropZone, Timeline, BeverageAmbience, etc.). Use find-and-replace on the import paths.
- The `nayin.ts` library has no external dependencies beyond standard libraries. `favicon.ts` depends on `nayin.ts` — both move together.
- BeverageTransitionOverlay is rendered in `AppProviders.tsx` — update that import path.

**Patterns to follow:**
- `features/analysis/` module structure

**Test scenarios:**
- Happy path: `useNayin()` hook returns correct theme data after module move — all 5 elements render correctly
- Happy path: Beverage pour transition animation triggers on theme preview change
- Integration: `AppProviders.tsx` renders `<NayinProvider>` and `<BeverageTransitionOverlay>` from new paths without error

**Verification:**
- `client/src/contexts/NayinContext.tsx` no longer exists
- `client/src/lib/nayin.ts` and `client/src/lib/favicon.ts` no longer exist
- `client/src/components/Beverage*.tsx` no longer exist
- All nayin-related code lives under `client/src/features/nayin/`
- Build succeeds; nayin theming works identically

---

### U3. Move Analysis Components to features/analysis/views/

**Goal:** Move the six analysis-specific display components from flat `components/` into `features/analysis/views/`, completing the analysis feature module.

**Requirements:** R1, R2, R3, R5

**Dependencies:** U1, U2

**Files:**
- Move: `client/src/components/DropZone.tsx` → `client/src/features/analysis/views/DropZone.tsx`
- Move: `client/src/components/Timeline.tsx` → `client/src/features/analysis/views/Timeline.tsx`
- Move: `client/src/components/ShotTable.tsx` → `client/src/features/analysis/views/ShotTable.tsx`
- Move: `client/src/components/TemplateDraft.tsx` → `client/src/features/analysis/views/TemplateDraft.tsx`
- Move: `client/src/components/PromptDistill.tsx` → `client/src/features/analysis/views/PromptDistill.tsx`
- Move: `client/src/components/ShotStageIllustration.tsx` → `client/src/features/analysis/views/ShotStageIllustration.tsx`
- Modify: `client/src/features/analysis/views/WorkspaceLayout.tsx` — update imports from `@/components/` to `./`
- Modify: `client/src/features/analysis/views/WorkspaceStageRouter.tsx` — update imports
- Modify: `client/src/features/analysis/containers/AnalysisTimelineDrawer.tsx` — update Timeline import
- Modify: Any other files importing these components — update paths

**Approach:**
- These components are consumed primarily within `features/analysis/views/` (WorkspaceLayout, WorkspaceStageRouter) and `features/analysis/containers/` (AnalysisTimelineDrawer). After the move, most imports become relative `./` paths within the same module.
- DropZone and Timeline still have direct tRPC calls at this point — those are lifted in U6.
- ShotTable imports `STATUS_CONFIG` which was moved to `features/analysis/config/statusConfig.ts` in U1 — import path should already be correct or use a relative path within the module.

**Patterns to follow:**
- Existing views in `features/analysis/views/` (AnalysisWorkspace.tsx, WorkspaceLayout.tsx, etc.)

**Test scenarios:**
- Happy path: All six components render correctly at their new paths
- Happy path: WorkspaceLayout tabs between material/story tabs — both DropZone and StoryAgentChat render
- Integration: AnalysisTimelineDrawer opens Timeline from new import path

**Verification:**
- `client/src/components/` no longer contains DropZone, Timeline, ShotTable, TemplateDraft, PromptDistill, or ShotStageIllustration
- All imports resolve; build succeeds
- Workspace layout functions identically

---

### U4. Move Story Agent Components to features/storyAgent/views/

**Goal:** Move the three Story Agent display components from flat `components/` into `features/storyAgent/views/`, completing the story agent feature module structure.

**Requirements:** R1, R2, R3, R5

**Dependencies:** U1

**Files:**
- Create: `client/src/features/storyAgent/views/` directory
- Move: `client/src/components/StoryAgentChat.tsx` → `client/src/features/storyAgent/views/StoryAgentChat.tsx`
- Move: `client/src/components/StoryCardsBoard.tsx` → `client/src/features/storyAgent/views/StoryCardsBoard.tsx`
- Move: `client/src/components/ScriptViewer.tsx` → `client/src/features/storyAgent/views/ScriptViewer.tsx`
- Modify: `client/src/features/analysis/views/WorkspaceLayout.tsx` — update imports from `@/components/` to `@/features/storyAgent/views/`

**Approach:**
- These three components exclusively depend on `useStoryAgent()` context and have no relationship to other components in `components/`.
- WorkspaceLayout.tsx is their primary consumer — it renders StoryAgentChat in the left panel, StoryCardsBoard in the center, and ScriptViewer in the right.

**Patterns to follow:**
- `features/analysis/views/` structure

**Test scenarios:**
- Happy path: Switching to "故事" tab renders StoryAgentChat, StoryCardsBoard, and ScriptViewer from new paths
- Happy path: Story Agent conversation flow works end-to-end after the move

**Verification:**
- `client/src/components/` no longer contains StoryAgentChat, StoryCardsBoard, or ScriptViewer
- `client/src/features/storyAgent/views/` contains all three
- Build succeeds; story agent tab works identically

---

### U5. Split useAnalysisWorkspace into Focused Hooks

**Goal:** Replace the monolithic 28-return-value `useAnalysisWorkspace` hook with four focused hooks, each owning one concern and returning no more than ~10 values.

**Requirements:** R6, R7, R8, R9, AE2

**Dependencies:** U3

**Files:**
- Create: `client/src/features/analysis/hooks/useProjectData.ts`
- Create: `client/src/features/analysis/hooks/useAnalysisOrchestration.ts`
- Create: `client/src/features/analysis/hooks/useTweaks.ts`
- Create: `client/src/features/analysis/hooks/usePanelState.ts`
- Modify: `client/src/features/analysis/hooks/useAnalysisWorkspace.ts` — becomes a thin composition hook that calls the four focused hooks and returns their combined values (preserving backward compatibility during the transition)
- Modify: `client/src/features/analysis/views/AnalysisWorkspace.tsx` — migrate to calling focused hooks directly instead of the monolithic hook

**Approach:**
- **`useProjectData`** owns: `currentProjectId`, `setCurrentProjectId`, `projects`, `references`, `shots`, `refsQuery`, `shotsQuery`, auto-create-project logic. Depends on: tRPC queries for project/reference/shot lists.
- **`useAnalysisOrchestration`** owns: `analysisActive`, `analysisQuery`, `analysisRunMut`, `handleRunAnalysis`, `handleAnalysisComplete`, `onTimeRate`. Depends on: `currentProjectId` from `useProjectData` (passed as parameter).
- **`useTweaks`** owns: `grain`/`setGrain`, `jitter`/`setJitter`, `illustrationSize`/`setIllustrationSize`, `autoCycle`/`setAutoCycle`. Contains the CSS custom property side effects (`document.documentElement.style.setProperty`). No external dependencies.
- **`usePanelState`** owns: `timelineOpen`/`setTimelineOpen`, `selectedStage`/`setSelectedStage`, `activeInputTab`/`setActiveInputTab` (persisted to localStorage), `workspaceStageSticky`/`setWorkspaceStageSticky` (session-only). No external dependencies beyond localStorage.
- `useAnalysisWorkspace` is retained as a thin re-export wrapper initially, then removed once AnalysisWorkspace.tsx is updated to call the focused hooks directly.
- localStorage persistence keys (`dt:activeInputTab`) must remain unchanged to preserve user state across the refactor.

**Patterns to follow:**
- Existing hook patterns in `features/analysis/hooks/`
- localStorage persistence pattern already used in `useAnalysisWorkspace`

**Test scenarios:**
- Covers AE2. Happy path: `AnalysisWorkspace` renders calling `useProjectData()`, `usePanelState()`, `useTweaks()`, `useAnalysisOrchestration()` independently — each returns a focused object
- Happy path: `useTweaks` sets CSS custom properties on mount — `--workshop-grain`, `--workshop-jitter` reflect current values
- Happy path: `usePanelState` reads `activeInputTab` from localStorage on mount, persists changes back
- Happy path: `useProjectData` auto-creates a default project when the project list is empty
- Edge case: `usePanelState` with no localStorage value for `dt:activeInputTab` — defaults to `'material'`
- Edge case: `useAnalysisOrchestration` called with `null` projectId — queries are disabled, `analysisActive` is false
- Integration: Sticky workspace stage — once `workspaceStageSticky` set to true, remains true through re-renders until page reload
- Integration: `handleRunAnalysis` invalidates both analysis and shot queries, triggering re-fetches in `useProjectData`

**Verification:**
- No single hook returns more than 10 values
- Each hook's name clearly communicates its purpose
- All existing behavior preserved: tab persistence, sticky stage, auto-cycle, CSS tweaks, analysis flow
- `useAnalysisWorkspace.ts` either removed or reduced to a thin composition wrapper
- Build succeeds

---

### U6. Lift DropZone and Timeline Mutations to Hook Layer

**Goal:** Remove direct tRPC calls from DropZone and Timeline, making them pure "props-in, UI-out" display components consistent with the Platform layer rules in `analysis-architecture.md`.

**Requirements:** R14, R15, R16, AE4

**Dependencies:** U3, U5

**Files:**
- Modify: `client/src/features/analysis/views/DropZone.tsx` — remove `trpc.reference.upload.useMutation()` and `trpc.useUtils()`, accept `onUploadFiles` prop callback
- Modify: `client/src/features/analysis/views/Timeline.tsx` — remove `trpc.reference.update.useMutation()` and `trpc.useUtils()`, accept `onPin` and `onExclude` prop callbacks
- Modify: `client/src/features/analysis/hooks/useProjectData.ts` (or `useAnalysisOrchestration.ts`) — add upload mutation setup and pin/exclude mutation setup, expose callbacks
- Modify: `client/src/features/analysis/views/WorkspaceLayout.tsx` — pass new callbacks from hooks to DropZone and Timeline as props

**Approach:**
- **DropZone lifting**: The component currently calls `uploadMut.mutateAsync({projectId, fileName, mimeType, fileBase64, sourceType})` inside `processFiles`. Create an `onUploadFiles: (files: FileWithMeta[]) => Promise<void>` callback in the hook layer that handles the mutation + cache invalidation. DropZone keeps its drag/drop/paste UI logic, file reading, progress tracking, and base64 encoding — only the tRPC call moves up.
- **Timeline lifting**: The component calls `updateRefMut.mutateAsync({id, pinned/excluded})` in `handlePin` and `handleExclude`. Create `onPin: (ref: BackendReference) => Promise<void>` and `onExclude: (ref: BackendReference) => Promise<void>` callbacks in the hook layer.
- The mutations fit naturally in `useProjectData` since they operate on reference data that the hook already queries.
- After lifting, `grep -r "trpc\." client/src/features/analysis/views/` should show zero results (only hooks import tRPC).

**Patterns to follow:**
- Origin key decision: "Lift mutations, don't create mutation hooks" — callbacks go directly into existing hooks, not new per-component hooks
- Existing pattern: `onRunAnalysis` and `onAnalysisComplete` are already lifted from DropZone to the hook layer

**Test scenarios:**
- Covers AE4. Happy path: User uploads a file via DropZone — `onUploadFiles` prop is called, file appears in reference list after cache invalidation
- Happy path: User pins a reference in Timeline — `onPin` prop is called, reference shows pinned state after refetch
- Happy path: User excludes a reference in Timeline — `onExclude` prop is called, reference shows excluded state
- Edge case: Upload fails (network error) — error propagates through the callback, DropZone UI shows error state
- Integration: After upload completes, `useProjectData` invalidates reference list query — Timeline updates with new reference

**Verification:**
- `grep -r "trpc" client/src/features/analysis/views/DropZone.tsx` returns zero results
- `grep -r "trpc" client/src/features/analysis/views/Timeline.tsx` returns zero results
- DropZone and Timeline have no `import.*trpc` statements
- Upload, pin, and exclude functionality works identically
- Build succeeds

---

### U7. Add Story Agent tRPC Procedures (Server-Side)

**Goal:** Create tRPC procedures that wrap the existing archive Story Agent functions, providing a tRPC API surface that matches the current REST endpoint request/response shapes.

**Requirements:** R10, R11

**Dependencies:** None (server-side, independent of frontend units)

**Files:**
- Modify: `server/routers.ts` — replace the existing simplified `storyAgent` sub-router with expanded procedures wrapping archive functions
- Modify: `server/archive/storyAgent.ts` — ensure exported functions and types are importable by the router (may need to export additional types)

**Approach:**
- The existing `storyAgent.chat` and `storyAgent.generateScript` tRPC procedures have simpler prompts than the archive versions. Replace them with procedures that call `replyFromStoryAgent` and `synthesizeShotList` from `server/archive/storyAgent.ts`.
- Add new procedures for the remaining archive endpoints:
  - `storyAgent.chat` (mutation) — wraps `replyFromStoryAgent`
  - `storyAgent.classify` (mutation) — wraps `synthesizeShotList`
  - `storyAgent.summarize` (mutation) — wraps `summarizeHistory`
  - `storyAgent.storyList` (query) — wraps `GET /api/archive/stories` logic
  - `storyAgent.storyGet` (query) — wraps `GET /api/archive/stories/:id` logic
  - `storyAgent.storyUpsert` (mutation) — wraps `POST /api/archive/stories` logic
  - `storyAgent.storyDelete` (mutation) — wraps `DELETE /api/archive/stories/:id` logic
- Define Zod input schemas matching the current fetch request bodies. Define output types matching the current response shapes.
- The archive REST endpoints remain functional during migration — both paths coexist until U8 is verified.
- Story CRUD may require direct database access similar to how the archive REST handlers work — check the express handlers in `server/_core/index.ts` for the exact DB operations.

**Patterns to follow:**
- Existing tRPC procedure patterns in `server/routers.ts` (e.g., `analysis.run`, `reference.upload`)
- Zod schema patterns used throughout the router

**Test scenarios:**
- Happy path: `storyAgent.chat` mutation accepts message + history + context, returns reply + card + read + configured + modelLabel — identical shape to archive REST endpoint
- Happy path: `storyAgent.classify` mutation accepts cards + characterHint, returns characters + arc + logline + theme + variants + boringCheck + shots
- Happy path: `storyAgent.storyList` query returns array of story summaries
- Happy path: `storyAgent.storyUpsert` mutation creates new story, returns id; calling again with same id updates it
- Happy path: `storyAgent.storyDelete` mutation removes story, returns ok
- Error path: `storyAgent.chat` with empty message — returns appropriate error
- Error path: `storyAgent.classify` with empty cards array — returns error or empty result

**Verification:**
- All 7 tRPC procedures defined and callable
- Each procedure's input/output shapes match the corresponding archive REST endpoint
- Existing REST endpoints still functional (coexistence during migration)
- Server starts without errors; tRPC panel (if available) shows new procedures

---

### U8. Migrate StoryAgentContext from fetch() to tRPC

**Goal:** Replace all six `fetch()` calls in `StoryAgentContext` with the corresponding tRPC mutations/queries from U7, eliminating the dual data-fetching pattern.

**Requirements:** R10, R12, AE3

**Dependencies:** U7

**Files:**
- Modify: `client/src/features/storyAgent/StoryAgentContext.tsx` — replace all `fetch()` calls with `trpc.storyAgent.*` mutations/queries
- Modify: `client/src/lib/trpc.ts` — verify the tRPC client types include the new `storyAgent` procedures (should auto-infer from router type)

**Approach:**
- Replace each `fetch()` call site with its tRPC equivalent:
  - `fetch('/api/archive/stories')` → `trpc.storyAgent.storyList.useQuery()`
  - `fetch('/api/archive/stories/:id')` → `trpc.storyAgent.storyGet.useQuery({id})`
  - `fetch('/api/archive/story-agent-chat', POST)` → `trpc.storyAgent.chat.useMutation()`
  - `fetch('/api/archive/story-agent-classify', POST)` → `trpc.storyAgent.classify.useMutation()`
  - `fetch('/api/archive/stories', POST)` → `trpc.storyAgent.storyUpsert.useMutation()`
  - `fetch('/api/archive/stories/:id', DELETE)` → `trpc.storyAgent.storyDelete.useMutation()`
- Preserve all existing localStorage persistence logic — only the network layer changes.
- The context's state management (cards, shots, characters, messages, etc.) remains unchanged.
- Error handling: tRPC mutations throw on error; ensure the context's try/catch blocks handle tRPC errors the same way they handle fetch errors.
- The `summarizeHistory` call (if used) maps to `trpc.storyAgent.summarize.useMutation()`.

**Patterns to follow:**
- Existing tRPC usage patterns in `useProjectData` / `useAnalysisOrchestration` hooks
- `trpc.useUtils()` for cache invalidation after mutations

**Test scenarios:**
- Covers AE3. Happy path: User sends a message in StoryAgentChat — request goes through `trpc.storyAgent.chat.useMutation()`, reply appears in chat
- Happy path: User generates script — request goes through `trpc.storyAgent.classify.useMutation()`, shots and script appear
- Happy path: Story auto-saves via `trpc.storyAgent.storyUpsert.useMutation()` — story persists to database
- Happy path: Story list loads via `trpc.storyAgent.storyList.useQuery()` on context mount
- Happy path: Story deletion works via `trpc.storyAgent.storyDelete.useMutation()`
- Edge case: Network error during chat — error state shown, conversation not corrupted
- Edge case: Context mounts with no projectId — queries disabled, no network requests
- Integration: Full conversation flow — send message → receive reply with card → cards accumulate → generate script → shots appear in ShotTable → auto-save story

**Verification:**
- `grep -r "fetch(" client/src/features/storyAgent/StoryAgentContext.tsx` returns zero results
- All Story Agent operations use tRPC
- localStorage persistence still works (conversation, cards, shots survive page reload)
- `grep -r "trpc\." client/src/components/` returns zero results (success criterion from origin)
- Build succeeds; full story agent workflow functional

---

## System-Wide Impact

- **Interaction graph:** `AppProviders.tsx` loses `<ThemeProvider>`, gains updated import paths for `NayinProvider` and `BeverageTransitionOverlay`. `AnalysisWorkspace.tsx` changes from one hook call to four. `WorkspaceLayout.tsx` gains new prop callbacks for upload/pin/exclude. `server/routers.ts` gains expanded `storyAgent` sub-router.
- **Error propagation:** Mutation errors currently bubble up through tRPC's error handling. After lifting, the same errors propagate through callbacks — display components receive errors via their existing error-state patterns. No change to error semantics.
- **State lifecycle risks:** localStorage keys must not change during the refactor (`dt:activeInputTab`, story agent persistence keys). The ThemeContext removal must not break dark-mode class application. Hook split must not introduce stale closures between the four hooks — each hook should use its own state, not share mutable refs across hooks.
- **API surface parity:** The new tRPC `storyAgent` procedures must exactly match the archive REST endpoint behavior. Both APIs coexist until the REST endpoints are removed in a future cleanup.
- **Unchanged invariants:** All AI prompt logic in `server/archive/storyAgent.ts` is not modified. All UI/UX visual appearance unchanged. Analysis engine logic unchanged. Shot production pipeline unchanged.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Import path mass-rename introduces typos | TypeScript compiler catches all broken imports; run `tsc --noEmit` after each file-move unit |
| Hook split introduces subtle state timing bugs | Each hook is self-contained; `useAnalysisOrchestration` receives `projectId` as a parameter, not via shared context. Verify with manual testing of the full analysis flow. |
| Story Agent tRPC migration changes behavior subtly | The tRPC procedures wrap the exact same functions. Response shapes are validated by Zod schemas. Run full conversation + script generation flow manually. |
| ThemeContext removal breaks dark mode | Hardcode `class="dark"` on `<html>` in `index.html` before removing ThemeProvider. Visual diff check. |
| Circular dependency between hooks | `useAnalysisOrchestration` depends on `useProjectData`'s `currentProjectId` — passed as parameter, not circular. `useTweaks` and `usePanelState` have zero dependencies on other hooks. |

---

## Sources & References

- **Origin document:** [docs/brainstorms/frontend-architecture-refactor-requirements.md](docs/brainstorms/frontend-architecture-refactor-requirements.md)
- Architecture doc: `docs/analysis-architecture.md`
- Prior plan: `docs/plans/2026-05-09-001-refactor-analysis-page-architecture-plan.md`
- Key source files: `client/src/features/analysis/hooks/useAnalysisWorkspace.ts`, `client/src/features/storyAgent/StoryAgentContext.tsx`, `server/routers.ts`, `server/archive/storyAgent.ts`
