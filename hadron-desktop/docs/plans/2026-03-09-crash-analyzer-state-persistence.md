# Crash Analyzer State Persistence — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Preserve the crash analyzer's uploaded file info and analysis result across tab switches, so users don't lose work when navigating away.

**Architecture:** Lift crash-specific local state from `FileDropZone` into the existing `useAppState` global reducer, following the same pattern used by Code Analyzer's `codeInput`/`codeAnalysisResult`. Fix the `SET_VIEW` reducer to stop clearing `analysisResult` on navigate-to-analyze.

**Tech Stack:** React 18, TypeScript, useReducer (existing `useAppState` hook)

---

### Task 1: Add crash file state to the global reducer

**Files:**
- Modify: `src/hooks/useAppState.ts:39-80` (AppState interface)
- Modify: `src/hooks/useAppState.ts:86-137` (AppAction type)
- Modify: `src/hooks/useAppState.ts:143-165` (initialState)

**Step 1: Add state fields to `AppState` interface**

In `src/hooks/useAppState.ts`, add two new fields to the `AppState` interface after line 55 (`analysisResult`):

```typescript
  // Crash Analyzer persistence
  crashFile: { path: string; name: string } | null;
  crashAnalysisResult: AnalysisResult | null;
```

**Step 2: Add new action types to `AppAction`**

After line 105 (`CLEAR_ANALYSIS`), add:

```typescript
  // Crash Analyzer persistence
  | { type: 'SET_CRASH_FILE'; payload: { path: string; name: string } }
  | { type: 'CLEAR_CRASH_FILE' }
  | { type: 'SET_CRASH_ANALYSIS_RESULT'; payload: AnalysisResult }
  | { type: 'CLEAR_CRASH_ANALYSIS_RESULT' }
```

**Step 3: Add initial values**

In `initialState` (line 143-165), add after `analysisResult: null,` (line 149):

```typescript
  crashFile: null,
  crashAnalysisResult: null,
```

**Step 4: Commit**

```bash
git add src/hooks/useAppState.ts
git commit -m "feat: add crashFile and crashAnalysisResult state fields to global reducer"
```

---

### Task 2: Add reducer cases and action creators

**Files:**
- Modify: `src/hooks/useAppState.ts:171-405` (appReducer)
- Modify: `src/hooks/useAppState.ts:411-534` (useAppState hook — action creators)

**Step 1: Fix `SET_VIEW` to preserve `analysisResult`**

In the `SET_VIEW` case (lines 183-190), remove the line that clears `analysisResult` when navigating to analyze. Change:

```typescript
    case 'SET_VIEW':
      return {
        ...state,
        currentView: action.payload,
        // Clear analysis result when switching away from analyze view
        ...(action.payload !== 'analyze' ? {} : { analysisResult: null }),
        error: null,
      };
```

To:

```typescript
    case 'SET_VIEW':
      return {
        ...state,
        currentView: action.payload,
        error: null,
      };
```

**Step 2: Add reducer cases for crash persistence actions**

After the `CLEAR_ANALYSIS` case (line 247), add:

```typescript
    // Crash Analyzer persistence
    case 'SET_CRASH_FILE':
      return {
        ...state,
        crashFile: action.payload,
      };

    case 'CLEAR_CRASH_FILE':
      return {
        ...state,
        crashFile: null,
      };

    case 'SET_CRASH_ANALYSIS_RESULT':
      return {
        ...state,
        crashAnalysisResult: action.payload,
      };

    case 'CLEAR_CRASH_ANALYSIS_RESULT':
      return {
        ...state,
        crashAnalysisResult: null,
        crashFile: null,
      };
```

**Step 3: Add action creators to `useAppState()` hook**

After `clearAnalysis` (line 460), add:

```typescript
    // Crash Analyzer persistence
    setCrashFile: useCallback(
      (path: string, name: string) =>
        dispatch({ type: 'SET_CRASH_FILE', payload: { path, name } }),
      []
    ),
    clearCrashFile: useCallback(() => dispatch({ type: 'CLEAR_CRASH_FILE' }), []),
    setCrashAnalysisResult: useCallback(
      (result: AnalysisResult) => dispatch({ type: 'SET_CRASH_ANALYSIS_RESULT', payload: result }),
      []
    ),
    clearCrashAnalysisResult: useCallback(() => dispatch({ type: 'CLEAR_CRASH_ANALYSIS_RESULT' }), []),
```

**Step 4: Commit**

```bash
git add src/hooks/useAppState.ts
git commit -m "feat: add crash persistence reducer cases and action creators"
```

---

### Task 3: Wire crash file persistence into App.tsx

**Files:**
- Modify: `src/App.tsx:297-355` (handleFileSelect)
- Modify: `src/App.tsx:526-550` (analyze view rendering)

**Step 1: Store crash file info in `handleFileSelect`**

In `handleFileSelect` (line 298), after `actions.startAnalysis()` (line 299), add:

```typescript
    // Persist file info in global state
    const fileName = filePath.split(/[\\/]/).pop() || filePath;
    actions.setCrashFile(filePath, fileName);
```

**Step 2: Pass `crashFile` and `crashAnalysisResult` to FileDropZone**

In the analyze view JSX (lines 534-541), update the `FileDropZone` usage:

```typescript
                {!analysisResult && (
                  <FileDropZone
                    onFileSelect={handleFileSelect}
                    onBatchSelect={handleBatchSelect}
                    onOpenAnalysis={(analysis) => actions.viewAnalysis(analysis)}
                    isAnalyzing={analyzing}
                    crashFile={crashFile}
                    crashAnalysisResult={crashAnalysisResult}
                    onClearCrashAnalysisResult={actions.clearCrashAnalysisResult}
                  />
                )}
```

**Step 3: Destructure new state fields from `state`**

Find the existing destructure of `state` (look for where `analysisResult`, `analyzing`, etc. are destructured from `state`) and add `crashFile` and `crashAnalysisResult`.

**Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire crash file persistence through App.tsx to FileDropZone"
```

---

### Task 4: Update FileDropZone to use global crash state

**Files:**
- Modify: `src/components/FileDropZone.tsx:12-17` (props interface)
- Modify: `src/components/FileDropZone.tsx:49` (component signature)
- Modify: `src/components/FileDropZone.tsx:162-261` (render — Crash Ingestion panel)

**Step 1: Extend `FileDropZoneProps`**

Update the props interface (lines 12-17):

```typescript
interface FileDropZoneProps {
  onFileSelect: (filePath: string, analysisType: string, analysisMode: AnalysisMode) => void;
  onBatchSelect?: (filePaths: string[], analysisType: string, analysisMode: AnalysisMode) => void;
  onOpenAnalysis?: (analysis: Analysis) => void;
  isAnalyzing: boolean;
  crashFile?: { path: string; name: string } | null;
  crashAnalysisResult?: AnalysisResult | null;
  onClearCrashAnalysisResult?: () => void;
}
```

Add import for `AnalysisResult`:

```typescript
import type { AnalysisResult } from "../types/index";
```

**Step 2: Accept new props in component**

Update the component signature (line 49):

```typescript
export default function FileDropZone({
  onFileSelect, onBatchSelect, onOpenAnalysis, isAnalyzing,
  crashFile, crashAnalysisResult, onClearCrashAnalysisResult
}: FileDropZoneProps) {
```

**Step 3: Show file-loaded indicator when `crashFile` is set**

In the dropzone area (lines 193-227), when `crashFile` is set and `isAnalyzing` is true, show the file name above the progress bar. This is already handled — when `isAnalyzing` is true, the progress bar shows. Add the filename display inside the analyzing block (lines 172-180):

```typescript
          {isAnalyzing ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-10 h-10 text-emerald-400 mb-4 animate-spin" />
              <p className="text-base font-semibold mb-4" style={{ color: 'var(--hd-text)' }}>
                Analyzing {crashFile?.name || 'crash log'}...
              </p>
              <div className="w-full max-w-md">
                <AnalysisProgressBar isAnalyzing={isAnalyzing} />
              </div>
            </div>
```

**Step 4: Show inline result summary when `crashAnalysisResult` is set**

After the analyzing block and before the dropzone (between the `isAnalyzing` ternary at line 171 and the dropzone at line 183), add a third state: when not analyzing but `crashAnalysisResult` exists, show a compact result summary with a "New Analysis" button:

```typescript
          {isAnalyzing ? (
            /* ...existing analyzing block... */
          ) : crashAnalysisResult ? (
            <div className="flex flex-col items-center justify-center py-8">
              <div className="text-center mb-4">
                <p className="text-base font-semibold" style={{ color: 'var(--hd-text)' }}>
                  Analysis Complete
                </p>
                <p className="text-sm mt-1" style={{ color: 'var(--hd-text-muted)' }}>
                  {crashAnalysisResult.filename} — {crashAnalysisResult.severity} severity
                </p>
              </div>
              <div className="flex gap-3">
                <Button
                  onClick={onClearCrashAnalysisResult}
                  variant="primary"
                  size="md"
                  icon={<RotateCcw />}
                >
                  New Analysis
                </Button>
              </div>
            </div>
          ) : (
            /* ...existing dropzone JSX... */
          )}
```

Import `RotateCcw` from lucide-react (already imported at line 2).

**Step 5: Commit**

```bash
git add src/components/FileDropZone.tsx
git commit -m "feat: FileDropZone reads crash file and result from global state"
```

---

### Task 5: Store analysis result in global state on success

**Files:**
- Modify: `src/App.tsx:297-355` (handleFileSelect — success path)

**Step 1: Dispatch `setCrashAnalysisResult` on analysis success**

In `handleFileSelect`, after the `actions.viewAnalysis(fullAnalysis)` call (line 337), add:

```typescript
      // Persist result so it survives tab switches
      actions.setCrashAnalysisResult({
        id: result.id,
        filename: result.filename,
        severity: result.severity,
        error_type: result.error_type,
        root_cause: result.root_cause || '',
        suggested_fixes: result.suggested_fixes || '[]',
        analysis_mode: result.analysis_mode,
      });
```

Note: Verify the shape of `AnalysisResult` type in `types/index.ts` and map from `result` (the return value of `analyzeCrashLog`) accordingly. The `result` variable already has these fields — use them directly.

**Step 2: Clear crash file after successful analysis**

After the `setCrashAnalysisResult` call, add:

```typescript
      actions.clearCrashFile();
```

**Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat: persist crash analysis result in global state on success"
```

---

### Task 6: Verify and test

**Step 1: Run TypeScript compiler to check for type errors**

```bash
cd hadron-desktop && npx tsc --noEmit
```

Expected: No errors related to the new state fields.

**Step 2: Run the dev server**

```bash
cd hadron-desktop && npm run dev
```

**Step 3: Manual test checklist**

1. Upload a crash log → analysis starts → navigate to Settings → navigate back to Crash Analyzer → progress bar should still show (if still analyzing) or result should show (if done)
2. Analysis completes → navigate to Settings → navigate back → "Analysis Complete" summary should appear in the dropzone area
3. Click "New Analysis" → dropzone should reset to upload state
4. Upload a file → navigate away before analysis starts → navigate back → file should still be loaded

**Step 4: Commit any fixes**

```bash
git add -A && git commit -m "fix: address review feedback for crash state persistence"
```
