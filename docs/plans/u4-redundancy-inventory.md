# U4 Redundancy Inventory

Date: 2026-06-18

Scope confirmed for this unit:

- Move story panel visibility from `usePanelState` prop plumbing into the story spine UI slice.
- Replace `WorkspaceStageRouter`'s broad `useStoryAgent()` read with a narrow workspace-presence selector.
- Remove write-only collapsed-panel state in `WorkspaceLayout`.
- Leave runtime-gated design forks untouched.

## Applied

### Story panel visibility

- Source before U4: `usePanelState.visibleStoryPanels`, passed through `AnalysisWorkspace` -> `TopBar` and `WorkspaceStageRouter` -> `WorkspaceLayout`.
- Classification: `走脊柱`.
- Reason: this is client UI state and fits D1'. Keeping it in the spine removes cross-layout prop plumbing without taking ownership of server story body data.

### Workspace story presence

- Source before U4: `WorkspaceStageRouter` read `activeStoryId`, `cards`, and `storyList` from the full story agent context.
- Classification: `走脊柱`.
- Reason: the router only needs a boolean, so a selector isolates the route decision from unrelated story-agent state.

### Collapsed panel mirrors

- Source before U4: `WorkspaceLayout` wrote `leftCollapsed` and `centerCollapsed` from resizable callbacks.
- Classification: `真冗余可删`.
- Reason: the values were never read, so they were write-only local mirrors.

## Deferred

### `activeInputTab` and `workspaceStageSticky`

- Classification: `runtime-only (manual-gated)`.
- Reason: this state controls guided/workspace routing and is persisted in localStorage. It should be checked on the main repo dev server before any migration or deletion.

### `useProjectData.activeStoryId` and `shotsQuery`

- Classification: `runtime-only (manual-gated)`.
- Reason: this is a half-connected bridge around current story id and shot queries. It should not be deleted or wired during U4 without a separate runtime decision.

### `ScriptViewer.projectId`

- Classification: `runtime-only (manual-gated)`.
- Reason: generated image queries now follow `activeStoryId`, but `projectId` still gates a visible navigation affordance. Removing it may change UI behavior.

### Panel-local transient state

- Classification: `保留局部`.
- Reason: chat input, popover open state, animatic playback, prompt-table sort/filter state, and copy/history toggles are local interaction state rather than cross-panel truth.
