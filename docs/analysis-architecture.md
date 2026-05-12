# Drinking Time Analysis Architecture

This local refactor follows the design-system rules from the Helio notes:

- `App -> Business -> Platform -> External`
- routes stay thin
- page state has one owner
- visual components stay reusable where possible

## Layer mapping

### App

- `/Users/yuandai/Documents/New project/drinking-time-local/client/src/App.tsx`
- `/Users/yuandai/Documents/New project/drinking-time-local/client/src/app/providers/AppProviders.tsx`
- `/Users/yuandai/Documents/New project/drinking-time-local/client/src/app/router/AppRouter.tsx`
- `/Users/yuandai/Documents/New project/drinking-time-local/client/src/pages/AnalysisPage.tsx`

Responsibilities:

- application providers
- route wiring
- page entry points only

### Business

- `/Users/yuandai/Documents/New project/drinking-time-local/client/src/features/analysis/views/AnalysisWorkspace.tsx`
- `/Users/yuandai/Documents/New project/drinking-time-local/client/src/features/analysis/containers/AnalysisTimelineDrawer.tsx`
- `/Users/yuandai/Documents/New project/drinking-time-local/client/src/features/analysis/hooks/useAnalysisWorkspace.ts`
- `/Users/yuandai/Documents/New project/drinking-time-local/client/src/features/analysis/config/stageCopy.ts`
- `/Users/yuandai/Documents/New project/drinking-time-local/client/src/features/analysis/config/workshopCopy.ts`
- `/Users/yuandai/Documents/New project/drinking-time-local/client/src/features/analysis/types.ts`

Responsibilities:

- own page-level state
- own tRPC orchestration
- own page copy and stage semantics
- compose platform components into the Analysis Engine experience

### Platform

- `/Users/yuandai/Documents/New project/drinking-time-local/client/src/components/*`
- `/Users/yuandai/Documents/New project/drinking-time-local/client/src/components/ui/*`
- `/Users/yuandai/Documents/New project/drinking-time-local/client/src/contexts/*`
- `/Users/yuandai/Documents/New project/drinking-time-local/client/src/lib/*`

Responsibilities:

- display panels
- shared UI primitives
- global contexts
- API client setup and utilities

## What changed in this pass

1. `AnalysisPage` is now a thin route shell.
2. `App.tsx` only wires providers and router.
3. Analysis state and data fetching now live in `useAnalysisWorkspace`.
4. The timeline drawer moved out of the page and became a business container.
5. Existing analysis can now restore more reliably after refresh because analysis and shot queries no longer depend on `analysisActive` to start loading.

## Next cleanup pass

To align even more closely with the design-system rules, the next pass should:

1. move upload and reference mutation logic out of `DropZone`
2. move pin/exclude mutation logic out of `Timeline`
3. split the current monitor panels into even more passive `Props-in / UI-out` view components
