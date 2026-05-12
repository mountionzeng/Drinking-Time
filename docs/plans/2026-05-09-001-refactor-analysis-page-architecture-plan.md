---
title: "refactor: Analysis Page Architecture Restructure + Nayin Theme Deepening"
type: refactor
status: active
date: 2026-05-09
origin: docs/brainstorms/analysis-page-architecture-requirements.md
---

# refactor: Analysis Page Architecture Restructure + Nayin Theme Deepening

## Summary

Restructure the `/analysis` page from an iframe shell + flat vertical scroll into a two-stage experience: a guided landing page for new/empty projects, and a left-center-right resizable panel workspace for active projects. Simultaneously expand the nayin five-element CSS variable system from 4 accent-only variables to a full surface/border/text token set, and fix the near-identical hue problem between gold and water themes so all five themes are visually distinct.

---

## Problem Frame

Users open the analysis page and face multiple empty panels with no guidance on where to start. The two creation paths (material-driven and story-driven) are mixed together without clear separation. Auxiliary modules (TweaksDock, StageAtlas) occupy prime screen space. Switching nayin themes only changes the accent color — 90% of the page surface stays the same white, making themes feel indistinguishable. (See origin: `docs/brainstorms/analysis-page-architecture-requirements.md`)

---

## Requirements

- R1. New users see a guided landing with two clear entry points (upload materials / start a story chat) within 5 seconds of opening the page
- R2. The workspace uses a left-center-right resizable panel layout with collapsible panels
- R3. Left panel provides tabbed switching between DropZone and StoryAgentChat
- R4. Center panel shows TemplateDraft (material path) or StoryCardsBoard (story path) based on active context
- R5. Right panel shows ShotTable (always) and PromptDistill (material path) or ScriptViewer (story path) when data exists
- R6. TopBar is simplified: project name + switcher + nayin button + user avatar; details move into popover
- R7. TweaksDock and StageAtlas are demoted to a settings menu (gear icon)
- R8. Nayin CSS variables expand to cover surface, border, and text-subtle tokens per element
- R9. Gold (metal) and water theme hues are visually distinguishable; water and earth saturation is increased
- R10. Background ambience opacity increases from 0.18 to 0.25-0.35

---

## Scope Boundaries

- Story Agent prompt strategy and conversation logic are not modified
- Backend API and database schema are unchanged
- Mobile responsive adaptation is deferred
- Creation Engine (node-based creation UI) is out of scope
- Cross-referencing between material-driven and story-driven data paths is deferred

### Deferred to Follow-Up Work

- Split `useAnalysisWorkspace` into smaller domain-specific hooks (analysis-architecture.md flagged this as a future cleanup)
- Per-element panel border styles (e.g., rounded for gold, sharp for fire) — low priority polish
- `docs/solutions/` learnings capture after this work lands

---

## Context & Research

### Relevant Code and Patterns

- `client/src/components/ui/resizable.tsx` — shadcn wrapper for `react-resizable-panels`, already installed, exports `ResizablePanelGroup`, `ResizablePanel`, `ResizableHandle`
- `client/src/features/analysis/views/AnalysisWorkspace.tsx` — current workspace view, uses `.workshop-trio` CSS grid for 3-column layout
- `client/src/features/analysis/hooks/useAnalysisWorkspace.ts` — central state orchestrator (~30 values/setters), manages tRPC queries, panel boot, UI state
- `client/src/contexts/NayinContext.tsx` — nayin element provider with daily refresh, transition animation, `data-nayin` attribute on `<html>`
- `client/src/index.css:116-152` — current `[data-nayin]` CSS variable overrides (4 variables per element)
- `client/src/components/BeverageAmbience.tsx` — background images + particle animations per element (opacity 0.18)
- `client/src/components/TopBar.tsx` — current TopBar with date, lunar, ganzhi, nayin, status legend
- `client/src/pages/AnalysisPage.tsx` — currently an iframe shell pointing to archive HTML
- `docs/analysis-architecture.md` — layer model: AnalysisPage must stay a thin route shell; state orchestration in Business layer hooks; visual components passive (props-in, UI-out)

### Institutional Learnings

No `docs/solutions/` exists yet. Key constraints carried from existing architecture docs:
- Panel structure components belong at Business layer (`features/analysis/`), panel primitives at Platform layer (`components/ui/`)
- `AnalysisPage.tsx` must remain a thin route shell — no orchestration logic
- The monitor-panel CSS pattern (`.monitor-panel` / `.monitor-panel-header` / `.monitor-panel-body`) is the standard card container across all components

### External References

Not needed — codebase has strong local patterns for all planned work.

---

## Key Technical Decisions

- **Use `react-resizable-panels` for workspace layout**: Already installed and wrapped as shadcn components. Provides drag-to-resize handles, min/max constraints, and collapsible panels out of the box. Replaces the current `.workshop-trio` CSS grid.
- **Workspace stage as hook state, not route**: The guided-landing → workspace transition is managed via `workspaceStage` state in `useAnalysisWorkspace`, not as separate routes. This keeps the URL at `/analysis` for both states and avoids breaking the existing routing setup.
- **Extend existing `[data-nayin]` CSS overrides**: Rather than a new theming system, add more CSS custom properties to the existing `[data-nayin="..."]` blocks in `index.css`. This preserves the current architecture where NayinContext sets `data-nayin` on `<html>` and CSS handles the rest.
- **Keep most child components unchanged**: DropZone, StoryAgentChat, TemplateDraft, PromptDistill, StoryCardsBoard retain their current internal logic. ShotTable receives a minor structural addition (status legend moved into its header from TopBar). Otherwise, only parent container and props interfaces change.
- **oklch color space throughout**: All new CSS variables use oklch() to match the existing convention.
- **Center panel follows left panel tab**: When left panel shows DropZone ("素材" tab), center shows TemplateDraft; when left panel shows StoryAgentChat ("故事" tab), center shows StoryCardsBoard. No separate center panel toggle — `activeInputTab` drives both.
- **Right panel content also follows active path**: When material path is active, right panel shows ShotTable + PromptDistill. When story path is active, right panel shows ShotTable + ScriptViewer (replacing PromptDistill). ShotTable is always visible since both paths produce shots.
- **Left panel tabs use CSS display toggling, not unmount**: Both DropZone and StoryAgentChat stay mounted when switching tabs. This preserves DropZone's upload state and StoryAgentChat's scroll position. Use `hidden` attribute or `display:none` on inactive tab content.
- **StoryAgentProvider mounts inside AnalysisWorkspace**: The provider needs `projectId` from `useAnalysisWorkspace`, so it wraps the view's children (GuidedLanding / WorkspaceLayout), not the hook. The `workspaceStage` is derived inside the view component where both the hook and story agent context are available.
- **Workspace stage is sticky within a session**: Once `workspaceStage` transitions from 'guided' to 'workspace', it stays 'workspace' until page reload. This prevents jarring snap-back if the user deletes all data mid-session (e.g., via StoryAgentChat's "重来" button).

---

## Open Questions

### Resolved During Planning

- **Where does panel collapse state live?** In `useAnalysisWorkspace` as `leftCollapsed` / `centerCollapsed` booleans, persisted to localStorage for session continuity.
- **How does the guided landing detect "empty project"?** Uses existing `references.length === 0` and story cards count (from StoryAgentContext) — if both are zero, show landing; otherwise show workspace. Derivation happens in the view component where both sources are available.
- **Where does ScriptViewer go?** In the right panel, replacing PromptDistill when the story path is active. Both paths share ShotTable; the second slot in the right panel toggles between PromptDistill (material) and ScriptViewer (story).
- **What determines center panel content when both paths have data?** `activeInputTab` drives both left and center panel content. No separate toggle needed.
- **Does the guided landing reappear if all data is deleted?** No — once `workspaceStage` transitions to 'workspace', it stays there for the session (sticky state). Only resets on page reload with zero data.
- **Do left panel tabs unmount inactive content?** No — both DropZone and StoryAgentChat stay mounted. CSS display toggling hides inactive content. This preserves upload state and chat scroll.
- **Where does StoryAgentProvider mount?** Inside `AnalysisWorkspace` view (after `useAnalysisWorkspace` provides `projectId`), wrapping the children. This avoids circular dependency.

### Deferred to Implementation

- Exact pixel breakpoints for panel min/max sizes — need to try in browser
- Whether center panel should auto-show when first analysis completes or require manual expansion
- Fine-tuning of new oklch values for each element — requires visual comparison in browser

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
AnalysisPage (thin route shell)
  └─ AnalysisWorkspace (view component, uses useAnalysisWorkspace hook)
       ├─ BeverageAmbience (background layer)
       ├─ TopBar (simplified)
       │    ├─ ProjectSwitcher (dropdown)
       │    ├─ NayinButton (small, opens popover with full lunar/ganzhi details)
       │    ├─ SettingsMenu (gear icon → TweaksDock + StageAtlas controls)
       │    └─ UserAvatar (dropdown)
       │
       └─ StoryAgentProvider (projectId from hook)
            │
            ├─ [if workspaceStage === 'guided']
            │    └─ GuidedLanding
            │         ├─ EntryCard "上传素材开始" → sets active tab to 'material', transitions to workspace
            │         └─ EntryCard "聊一段故事开始" → sets active tab to 'story', transitions to workspace
            │
            ├─ [if workspaceStage === 'workspace']
            │    └─ ResizablePanelGroup (horizontal)
            │         ├─ ResizablePanel (left, collapsible, ~25%)
            │         │    └─ Both mounted, CSS toggle visibility:
            │         │         DropZone (visible when activeInputTab='material')
            │         │         StoryAgentChat (visible when activeInputTab='story')
            │         ├─ ResizableHandle
            │         ├─ ResizablePanel (center, collapsible, ~35%)
            │         │    └─ TemplateDraft (when activeInputTab='material')
            │         │       StoryCardsBoard (when activeInputTab='story')
            │         ├─ ResizableHandle
            │         └─ ResizablePanel (right, ~40%)
            │              ├─ ShotTable (always)
            │              └─ PromptDistill (when material) | ScriptViewer (when story)
            │
            └─ AnalysisTimelineDrawer (bottom drawer, overlays full viewport)
```

---

## Implementation Units

### U1. Expand Nayin CSS Variables and Fix Color Differentiation

**Goal:** Expand the `[data-nayin]` CSS overrides from 4 accent variables to a full token set covering surface, border, and text colors. Fix the gold/water hue collision and raise water/earth saturation.

**Requirements:** R8, R9

**Dependencies:** None — foundation for all other units

**Files:**
- Modify: `client/src/index.css`

**Approach:**
- Add new CSS custom properties to each `[data-nayin="..."]` block: `--nayin-surface`, `--nayin-surface-dim`, `--nayin-text-subtle`, `--nayin-border`, `--nayin-bg-gradient`
- Also add a default set in `:root` so the variables exist even without `data-nayin`
- Fix color values:
  - Metal (gold): keep hue ~78 but bump chroma slightly for richer amber
  - Water (coconut): shift hue from 70 → ~45 (warmer ivory/sand direction) and raise chroma from 0.08 → 0.12+
  - Earth (coffee): raise chroma from 0.08 → 0.12+ for visible warmth
- Surface values should be very subtle tints (L: 0.97-0.99) — just enough to make white panels feel warm/cool/green per element
- Update existing `.monitor-panel` and `.workshop-paper` background styles to reference `--nayin-surface` where appropriate

**Patterns to follow:**
- Existing oklch() conventions in `index.css:116-152`
- Existing `--panel-bg`, `--panel-border` variables as baseline

**Test scenarios:**
- Happy path: switching data-nayin attribute on html element causes surface, border, and accent colors to all change
- Edge case: verify metal and water themes are visually distinguishable when applied to the same panel component
- Edge case: verify earth theme has visible warmth (not gray) on panel backgrounds

**Verification:**
- All five themes produce visually distinct page appearances when switching via TopBar
- No CSS variable is undefined in any theme (no fallback flash)

---

### U2. Increase Background Ambience Visibility

**Goal:** Raise the background image opacity and particle animation visibility so the beverage atmosphere is more noticeable.

**Requirements:** R10

**Dependencies:** U1

**Files:**
- Modify: `client/src/components/BeverageAmbience.tsx`

**Approach:**
- Increase background image opacity from 0.18 to ~0.28
- Adjust the cream overlay gradient to let more background through (reduce alpha values)
- Increase particle opacity ranges by ~30-50%
- Consider referencing `--nayin-surface` in the overlay gradient so it tints per-element

**Patterns to follow:**
- Existing particle component structure in BeverageAmbience.tsx (BubbleParticles, SteamWisps, etc.)
- oklch color values with alpha channels

**Test scenarios:**
- Happy path: background image and particles are visibly noticeable on the page without being distracting
- Edge case: text remains readable over the stronger background (contrast check)

**Verification:**
- Background ambience is clearly different for each element when switching themes
- Content panels remain legible over the stronger background

---

### U3. Simplify TopBar

**Goal:** Reduce TopBar information density. Keep project name, nayin button, settings gear, and user avatar. Move detailed lunar/ganzhi info into the nayin popover. Move status legend into ShotTable.

**Requirements:** R6, R7

**Dependencies:** U1 (uses new CSS variables for styling)

**Files:**
- Modify: `client/src/components/TopBar.tsx`
- Modify: `client/src/components/ShotTable.tsx`

**Approach:**
- TopBar: Remove inline date/lunar/ganzhi pills and status legend from the main bar. Keep the nayin theme button (emoji + element name). Add a settings gear icon that opens a dropdown/popover containing TweaksDock controls (autoCycle, illustrationSize, grain, jitter) and a link to StageAtlas
- TopBar: Add project name display and project switcher dropdown (currently in AnalysisWorkspace as project tabs)
- ShotTable: Move status legend (idea_pool, requirement_pool, etc.) into the ShotTable header area as a compact inline legend
- TopBar props interface will need to accept project list and current project for the switcher

**Patterns to follow:**
- Existing Popover usage in TopBar for the nayin theme picker
- DropdownMenu pattern from shadcn/ui components
- `.monitor-panel-header` pattern for ShotTable legend placement

**Test scenarios:**
- Happy path: TopBar shows project name, nayin emoji button, gear icon, user avatar — nothing else in the main row
- Happy path: clicking nayin button opens popover with full lunar/ganzhi details and theme switcher
- Happy path: clicking gear icon opens settings with TweaksDock controls
- Happy path: ShotTable shows status legend in its own header
- Edge case: long project name truncates gracefully

**Verification:**
- TopBar height is reduced compared to current version
- All functionality that was removed from TopBar is accessible via popover/dropdown
- Status legend appears inside ShotTable

---

### U4. Create Guided Landing Component

**Goal:** Build the guided landing page that appears when a project has no materials and no story cards. Two entry cards guide the user to choose a path.

**Requirements:** R1

**Dependencies:** U1 (theme styling), U3 (simplified TopBar)

**Files:**
- Create: `client/src/features/analysis/views/GuidedLanding.tsx`

**Approach:**
- Two large entry cards centered on the page, using monitor-panel styling with nayin theming
- Card 1: "上传素材开始" with Upload icon — on click, sets left panel active tab to 'material' and transitions to workspace stage
- Card 2: "聊一段故事开始" with MessageCircle icon — on click, sets left panel active tab to 'story' and transitions to workspace stage
- Bottom text: "两条路径最终都会汇聚到镜头表，你也可以两个都用"
- Entry animation using framer-motion with the project's standard easing `[0.22, 1, 0.36, 1]`
- Component receives callbacks as props (onSelectMaterial, onSelectStory) — no internal routing or state
- Use beverage-themed copy via `Record<NayinElement, ...>` map following existing convention

**Patterns to follow:**
- `.workshop-empty-illustration` pattern for centered content with illustration
- `ShotStageIllustration` component for visual interest
- Beverage-themed `Record<NayinElement, ...>` copy maps (as in DropZone, TemplateDraft)
- framer-motion enter animation consistent with existing stagger pattern

**Test scenarios:**
- Happy path: landing shows two cards with clear labels and icons
- Happy path: clicking "上传素材" calls onSelectMaterial callback
- Happy path: clicking "聊故事" calls onSelectStory callback
- Edge case: cards use nayin-themed styling and change with theme switch

**Verification:**
- New users see a clean landing with exactly two choices
- Both cards are clickable and trigger the correct callback

---

### U5. Build Workspace Panel Layout

**Goal:** Create the three-panel resizable workspace layout using `react-resizable-panels`. Left panel has tabs, center panel shows processing views, right panel shows output.

**Requirements:** R2, R3, R4, R5

**Dependencies:** U1 (CSS variables), U4 (landing component for stage switching)

**Files:**
- Create: `client/src/features/analysis/views/WorkspaceLayout.tsx`

**Approach:**
- Use `ResizablePanelGroup` (horizontal direction) with three `ResizablePanel` children
- Left panel (~25%, min 200px, collapsible): tab-style header with "素材" and "故事" buttons. Both DropZone and StoryAgentChat are always mounted; inactive content hidden via CSS `display:none` (not unmount) to preserve upload state and chat scroll position
- Center panel (~35%, min 240px, collapsible): shows TemplateDraft when `activeInputTab='material'`, StoryCardsBoard when `activeInputTab='story'`. Shows an empty state with guidance text when the active path has no data yet
- Right panel (~40%, min 300px): ShotTable at top (always rendered, has its own empty state). Second slot: PromptDistill when `activeInputTab='material'`, ScriptViewer when `activeInputTab='story'`. Use a vertical scroll within the panel
- Each `ResizableHandle` uses `withHandle` for the grip icon
- Panel collapse state controlled via `ResizablePanel`'s `collapsedSize={0}` and `onCollapse`/`onExpand` callbacks
- The component receives all data as props from the workspace hook — no direct tRPC calls

**Patterns to follow:**
- `client/src/components/ui/resizable.tsx` wrapper components
- `client/src/components/ui/tabs.tsx` for left panel tab switching
- Props-in / UI-out pattern per architecture doc
- `.monitor-panel` CSS class for panel content containers

**Test scenarios:**
- Happy path: three panels render side by side with resizable handles between them
- Happy path: dragging a handle resizes adjacent panels
- Happy path: left panel tab buttons switch between DropZone and StoryAgentChat visibility
- Happy path: center panel shows TemplateDraft when material tab active, StoryCardsBoard when story tab active
- Happy path: right panel second slot shows PromptDistill (material) or ScriptViewer (story)
- Edge case: collapsing left panel gives more space to center+right
- Edge case: center panel shows empty state guidance when active path has no data
- Edge case: switching tabs preserves DropZone upload state (done state persists after tab round-trip)
- Edge case: switching tabs preserves StoryAgentChat scroll position and input draft
- Integration: uploading a file in DropZone triggers analysis, which populates center panel (TemplateDraft) and right panel (ShotTable)

**Verification:**
- All three panels render correctly with resizable behavior
- Tab switching in left panel works without losing component state (both components stay mounted)
- Panel collapse/expand works smoothly

---

### U6. Extend useAnalysisWorkspace and Rewire AnalysisWorkspace View

**Goal:** Extend the workspace hook with stage management, panel state, and active tab tracking. Rewrite AnalysisWorkspace to compose the new GuidedLanding and WorkspaceLayout components.

**Requirements:** R1, R2, R3, R4, R5

**Dependencies:** U3 (TopBar), U4 (GuidedLanding), U5 (WorkspaceLayout)

**Files:**
- Modify: `client/src/features/analysis/hooks/useAnalysisWorkspace.ts`
- Modify: `client/src/features/analysis/views/AnalysisWorkspace.tsx`
- Modify: `client/src/pages/AnalysisPage.tsx`

**Approach:**

**Hook extension (`useAnalysisWorkspace`):**
- Add `activeInputTab: 'material' | 'story'` with setter, persisted to localStorage
- Add `leftCollapsed: boolean` and `centerCollapsed: boolean` with setters, persisted to localStorage
- Add `workspaceStageSticky: boolean` — once set to true (via a setter), stays true for the session (not derived, not persisted). Prevents snap-back to guided landing on data deletion
- Remove `panelsBooted` stagger logic (replaced by panel layout's own mount behavior)
- Keep all existing tRPC queries and mutations unchanged
- Do NOT import useStoryAgent in the hook — story agent context is only available inside the provider, which mounts below the hook

**View rewrite (`AnalysisWorkspace`):**
- Render `useAnalysisWorkspace` hook at the top
- Mount `StoryAgentProvider` with `projectId` from the hook, wrapping children
- Inside the provider subtree, derive `workspaceStage`:
  - If `workspaceStageSticky` is true → 'workspace'
  - Else if `references.length > 0 || storyCards.length > 0` → 'workspace' (and set sticky)
  - Else → 'guided'
- Where `storyCards` comes from `useStoryAgent()` called inside a child component or via a small wrapper component within the provider
- Compose: BeverageAmbience + TopBar (simplified) + conditional GuidedLanding or WorkspaceLayout
- Keep AnalysisTimelineDrawer as bottom drawer overlaying the full viewport
- Remove ProfileRailDrawer from this view (functionality moved to TopBar user avatar dropdown)

**AnalysisPage route shell:**
- Replace iframe with direct `<AnalysisWorkspace />` render
- Remains a thin shell — no providers or orchestration logic here

**Patterns to follow:**
- Existing `useAnalysisWorkspace` flat-object return pattern
- Existing localStorage persistence pattern from sidebar width in DashboardLayout
- Architecture doc: AnalysisPage stays thin, AnalysisWorkspace composes

**Test scenarios:**
- Happy path: new project with no refs and no cards → shows GuidedLanding
- Happy path: selecting "upload materials" from landing → transitions to workspace with material tab active
- Happy path: project with existing refs → shows workspace directly
- Happy path: panel collapse state persists across page reload (localStorage)
- Integration: uploading first file transitions from guided landing to workspace automatically
- Integration: StoryAgent creating first card transitions from guided landing to workspace automatically
- Edge case: switching projects recalculates workspace stage correctly

**Verification:**
- `/analysis` renders React components directly (no iframe)
- Empty projects show guided landing
- Projects with data show workspace
- All existing functionality (upload, analysis, shot table, story agent) works in the new layout

---

### U7. Clean Up Deprecated Layout Code

**Goal:** Remove deprecated layout code and unused components that are replaced by the new architecture.

**Requirements:** None directly — code hygiene

**Dependencies:** U6 (all new layout is working)

**Files:**
- Modify: `client/src/index.css` (remove unused `.workshop-trio`, `.workshop-project-tabs`, `.workshop-narrator` CSS if no longer referenced)
- Delete or archive: `client/public/archive/drinking-time-workshop-ledger/` (the iframe HTML file)
- Modify: `client/src/components/DashboardLayout.tsx` (evaluate: if not used by any route, consider removal)

**Approach:**
- Grep for usage of `.workshop-trio`, `.workshop-project-tabs`, `.workshop-narrator` and other workshop-specific classes
- Remove CSS rules that are no longer referenced by any component
- Keep `.monitor-panel` and other patterns still in use
- Remove the archive HTML file since AnalysisPage no longer uses iframe
- Evaluate DashboardLayout — if no route uses it, flag for removal but don't delete without confirmation (it may be intended for future pages)

**Test expectation: none** — pure cleanup, no behavioral change

**Verification:**
- No console errors or missing styles after cleanup
- Application renders correctly without the removed code

---

## System-Wide Impact

- **Interaction graph:** AnalysisPage → AnalysisWorkspace → StoryAgentProvider → (GuidedLanding | WorkspaceLayout) → child components. TopBar now receives project list/switcher props from the workspace hook instead of being self-contained. StoryAgentContext is accessible within the provider subtree for stage determination and StoryCardsBoard/ScriptViewer rendering.
- **Error propagation:** No change — tRPC error handling and toast notifications remain in child components.
- **State lifecycle risks:** Panel collapse state in localStorage could conflict if multiple tabs are open. Accept this as a minor risk — last-write-wins is fine for this use case.
- **API surface parity:** No API changes. All tRPC endpoints remain unchanged.
- **Integration coverage:** The upload → analysis → shot table pipeline must work end-to-end in the new panel layout. Story agent → cards → script generation must work in the new panel layout.
- **Unchanged invariants:** All tRPC queries, mutations, NayinContext behavior, BeverageTransition animations, and backend APIs are explicitly not changed.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `react-resizable-panels` may have edge cases with framer-motion animations inside panels | Test early in U5; the library is already a project dependency and should work with React 19 |
| Panel min-size constraints may make the layout unusable on smaller desktop screens (<1200px) | Set reasonable minimums (200/240/300px) and allow collapse; defer full responsive design |
| Removing the iframe approach means the archive HTML is no longer a fallback | Keep the archive file until U7 confirms everything works; U7 is sequenced last |
| StoryAgentContext data needed for stage calculation but depends on projectId | StoryAgentProvider mounts inside AnalysisWorkspace view (below hook, above children). Stage derivation happens inside the provider subtree via a wrapper component, avoiding circular dependency |
| Color tuning (U1) may need iteration beyond initial values | Defer exact values to implementation; verify visually in browser |

---

## Sources & References

- **Origin document:** [docs/brainstorms/analysis-page-architecture-requirements.md](docs/brainstorms/analysis-page-architecture-requirements.md)
- Architecture doc: [docs/analysis-architecture.md](docs/analysis-architecture.md) — layer model constraints
- Design brief: [docs/claude-design-brief-handdrawn.md](docs/claude-design-brief-handdrawn.md) — visual warmth constraints
- react-resizable-panels shadcn wrapper: `client/src/components/ui/resizable.tsx`
