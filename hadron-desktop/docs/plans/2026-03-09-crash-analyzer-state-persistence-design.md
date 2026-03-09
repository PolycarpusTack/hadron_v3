# Crash Analyzer State Persistence

**Date:** 2026-03-09
**Status:** Approved

## Goal

Preserve uploaded file and analysis result in the crash analyzer across tab switches, so users don't lose their work when navigating to Settings or other views.

## Approach

Lift crash analyzer state into the existing `useAppState` reducer (Option A). Same pattern the Code Analyzer already uses with `codeInput`.

## New Global State

```typescript
crashFile: { path: string; name: string } | null   // uploaded file info
crashAnalysisResult: Analysis | null                // last completed result
```

## New Reducer Actions

- `SET_CRASH_FILE` — dispatched when user selects a file or pastes content
- `CLEAR_CRASH_FILE` — dispatched when analysis succeeds
- `SET_CRASH_ANALYSIS_RESULT` — dispatched when analysis completes
- `CLEAR_CRASH_ANALYSIS_RESULT` — dispatched when user starts new analysis

## Flow

1. User selects file → `SET_CRASH_FILE`
2. Analysis starts → existing `analyzing` flag
3. User navigates away → component unmounts, global state preserved
4. User returns → FileDropZone reads `crashFile`/`crashAnalysisResult` from global state
5. Analysis completes → `SET_CRASH_ANALYSIS_RESULT` + `CLEAR_CRASH_FILE`

## Files to Modify

- `src/hooks/useAppState.ts` — add state fields + actions
- `src/App.tsx` — pass new state/actions to FileDropZone
- `src/components/FileDropZone.tsx` — read from global state, dispatch instead of local setState

## What Stays the Same

- `analysisType` persists via localStorage
- Recent analyses refetched on mount (DB query)
- Detail view routing unchanged
- Drag-and-drop unchanged
