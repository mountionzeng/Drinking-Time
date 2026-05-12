---
date: 2026-05-09
topic: frontend-architecture-refactor
---

# Frontend Architecture Refactor — File Organization, State Management, API Unification

## Summary

Restructure the frontend codebase from a flat `components/` directory + monolithic hook into feature-grouped modules with clear boundaries. Split `useAnalysisWorkspace` into focused hooks, migrate Story Agent data fetching from `fetch()` to tRPC, and archive dead code — all without changing AI logic, prompt strategy, or UI/UX design.

---

## Problem Frame

Drinking Time's `client/src/components/` directory holds 21 business components in a single flat folder alongside 50+ shadcn/ui primitives. Opening the directory gives no signal about which files belong to the analysis engine, which belong to the story agent, and which are global decoration. Three Story Agent components (`StoryAgentChat`, `StoryCardsBoard`, `ScriptViewer`) sit in `components/` even though they exclusively depend on `useStoryAgent()` context and have no relationship to the other components around them.

The central state hook `useAnalysisWorkspace` returns ~30 values covering project data, panel state, visual tweaks, and analysis orchestration — a single function that owns too many concerns. Developers cannot tell which part of the hook powers which part of the UI.

Meanwhile, Story Agent uses raw `fetch()` to call archive API endpoints while the rest of the app uses tRPC, creating two incompatible patterns for data fetching in the same page.

Several components (`ManusDialog`, `Map`, `DashboardLayout`, `ProfileRailDrawer`, `TweaksDock`, `StageAtlas`) are no longer imported by any active code but still sit in the main directory, adding noise.

The project has an existing architecture doc (`docs/analysis-architecture.md`) defining a four-layer model (App → Business → Platform → External), but the actual directory structure has only partially been aligned to it.

---

## Requirements

**File organization**

- R1. Business components are grouped by feature module (e.g., `features/analysis/`, `features/storyAgent/`, `features/nayin/`), not dumped in a flat `components/` directory
- R2. Each feature module contains its own views, hooks, config, types, and containers subdirectories as needed — matching the pattern already started in `features/analysis/`
- R3. The top-level `components/` directory contains only truly shared, feature-agnostic components (e.g., `ErrorBoundary`) and the `ui/` shadcn primitives
- R4. Components no longer imported by any active code are moved to `client/src/archive/` for reference, not deleted
- R5. Each module directory has a clear single responsibility that can be explained in one sentence

**State management**

- R6. `useAnalysisWorkspace` is split into multiple focused hooks, each owning one concern (e.g., project data, panel layout state, visual tweaks, analysis orchestration)
- R7. The split hooks compose cleanly — the workspace view can call each one independently without a single 30-field return object
- R8. Panel collapse state and active input tab continue to persist to localStorage across reloads
- R9. The sticky workspace-stage behavior (once 'workspace', stays 'workspace' until reload) is preserved

**API unification**

- R10. Story Agent's `fetch()` calls to `/api/archive/story-agent-chat` and `/api/archive/story-agent-classify` are migrated to tRPC router endpoints
- R11. The tRPC migration preserves identical request/response shapes — the AI backend logic is not modified
- R12. After migration, `StoryAgentContext` uses `trpc.storyAgent.*` mutations/queries instead of raw `fetch()`
- R13. The archive fetch endpoints may be removed from the server once the tRPC migration is verified

**Data-fetching boundary cleanup**

- R14. `DropZone` no longer calls tRPC mutations directly — upload mutations are lifted to the hook layer and passed as props
- R15. `Timeline` no longer calls tRPC mutations directly — reference update mutations are lifted to the hook layer and passed as props
- R16. After lifting, these components become pure "props-in, UI-out" display components, consistent with `analysis-architecture.md`'s Platform layer rules

**Dead code cleanup**

- R17. `ThemeContext` (superseded by `NayinContext`) is moved to archive
- R18. `mockData.ts` is split: active config constants (`STATUS_CONFIG`, `PRIORITY_CONFIG`, `SOURCE_TYPE_CONFIG`) and type definitions (`ShotStatus`, `Priority`) move to appropriate feature module type/config files; unused mock data arrays (`MOCK_SHOTS`, `MOCK_FRAGMENTS`, `TEMPLATE_DRAFT`) are removed or archived
- R19. Orphaned components (`ManusDialog`, `Map`, `DashboardLayout`, `DashboardLayoutSkeleton`, `ProfileRailDrawer`, `TweaksDock`, `StageAtlas`) are moved to archive

---

## Acceptance Examples

- AE1. **Covers R1, R3.** Given the refactored codebase, when a developer opens `client/src/components/`, they see only shared utilities (`ErrorBoundary`) and the `ui/` folder — no business-specific components.
- AE2. **Covers R6, R7.** Given the split hooks, when `AnalysisWorkspace` renders, it calls focused hooks like `useProjectData()`, `usePanelState()`, `useTweaksState()` independently — no single hook returns more than ~10 values.
- AE3. **Covers R10, R12.** Given the tRPC migration, when a user sends a message in StoryAgentChat, the request goes through `trpc.storyAgent.chat.useMutation()` instead of `fetch('/api/archive/story-agent-chat')`.
- AE4. **Covers R14, R16.** Given the DropZone refactor, when a user uploads a file, `DropZone` calls an `onUpload` prop callback — it does not import or call `trpc` directly.

---

## Success Criteria

- A developer unfamiliar with the project can find any component's file within 10 seconds by navigating the feature module directory structure
- Each hook's purpose is obvious from its name and return type
- `grep -r "trpc\." client/src/components/` returns zero results (no direct tRPC in display components, only in hooks/contexts)
- All existing user-facing functionality works identically after the refactor — no visual or behavioral changes
- The archive directory exists as a safety net; git history preserves full history

---

## Scope Boundaries

- AI prompt strategy, conversation logic, and analysis engine algorithms are not modified
- UI/UX design, layout, visual styling, and component appearance are not changed
- Mobile responsive adaptation is deferred
- No new features are added — this is purely organizational and structural
- `useAnalysisWorkspace` is split but not fundamentally redesigned — the same data flows, just better organized
- Backend tRPC router additions for Story Agent are minimal wrappers around existing logic

---

## Key Decisions

- **Feature modules over domain layers**: Group by feature (`features/analysis/`, `features/storyAgent/`, `features/nayin/`) rather than by technical layer (`hooks/`, `views/`, `contexts/` at the top level). Each feature module owns its own hooks/views/types internally. This matches the pattern already started with `features/analysis/`.
- **Archive over delete**: Unused components go to `client/src/archive/` rather than being deleted. Git history is the real safety net, but an archive directory makes recovery discoverable without git commands.
- **tRPC for Story Agent**: Unify on tRPC rather than keeping fetch. The app already has full tRPC infrastructure; having two patterns increases cognitive load for no benefit.
- **Lift mutations, don't create mutation hooks**: When extracting tRPC calls from DropZone and Timeline, lift the mutation setup into the parent hook and pass callbacks as props. Don't create per-component custom hooks — that would be an unnecessary abstraction layer for a single use site.

---

## Dependencies / Assumptions

- The existing tRPC router structure supports adding new `storyAgent` endpoints without architectural changes
- `StoryAgentContext`'s localStorage persistence pattern is retained — only the fetch layer changes
- The `docs/analysis-architecture.md` four-layer model (App → Business → Platform → External) is the target architecture, not just a suggestion

---

## Outstanding Questions

### Deferred to Planning

- [Affects R1][Technical] Exact directory tree for each feature module — which subdirectories does each module need (views/, hooks/, config/, types/, containers/)?
- [Affects R6][Technical] Exact split boundaries for `useAnalysisWorkspace` — how many hooks and what does each own?
- [Affects R10][Needs research] What is the exact request/response shape of the existing Story Agent fetch endpoints, and do they map cleanly to tRPC procedure types (query vs mutation)?
- [Affects R18][Technical] Which types from `mockData.ts` should live in `features/analysis/types.ts` vs a shared `lib/types.ts`?
