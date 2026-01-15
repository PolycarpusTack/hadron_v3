import { describe, expect, it } from "vitest";
import { appReducer, initialState, AppState, AppAction } from "./useAppState";
import type { AnalysisResult } from "../types";
import type { Analysis } from "../services/api";

// Helper to create mock analysis
function createMockAnalysis(overrides: Partial<Analysis> = {}): Analysis {
  return {
    id: 1,
    filename: "test.log",
    file_size_kb: 10,
    error_type: "MessageNotUnderstood",
    severity: "HIGH",
    root_cause: "Test root cause",
    suggested_fixes: "[]",
    analyzed_at: new Date().toISOString(),
    ai_model: "gpt-4",
    tokens_used: 100,
    cost: 0.01,
    was_truncated: false,
    is_favorite: false,
    view_count: 0,
    analysis_type: "complete",
    ...overrides,
  };
}

// Helper to create mock analysis result
function createMockAnalysisResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    id: 1,
    filename: "test.log",
    file_size_kb: 10,
    error_type: "MessageNotUnderstood",
    severity: "HIGH",
    root_cause: "Test root cause",
    suggested_fixes: "[]",
    analyzed_at: new Date().toISOString(),
    ai_model: "gpt-4",
    tokens_used: 100,
    cost: 0.01,
    was_truncated: false,
    is_favorite: false,
    view_count: 0,
    ...overrides,
  };
}

describe("appReducer", () => {
  describe("INIT_COMPLETE", () => {
    it("sets isInitializing to false and updates apiKey and darkMode", () => {
      const action: AppAction = {
        type: "INIT_COMPLETE",
        payload: { apiKey: "sk-test", darkMode: false },
      };

      const newState = appReducer(initialState, action);

      expect(newState.isInitializing).toBe(false);
      expect(newState.apiKey).toBe("sk-test");
      expect(newState.darkMode).toBe(false);
    });
  });

  describe("SET_VIEW", () => {
    it("changes the current view", () => {
      const action: AppAction = { type: "SET_VIEW", payload: "history" };

      const newState = appReducer(initialState, action);

      expect(newState.currentView).toBe("history");
    });

    it("clears any existing error", () => {
      const stateWithError: AppState = {
        ...initialState,
        error: { message: "Test error", suggestions: [] },
      };
      const action: AppAction = { type: "SET_VIEW", payload: "history" };

      const newState = appReducer(stateWithError, action);

      expect(newState.error).toBeNull();
    });
  });

  describe("VIEW_ANALYSIS", () => {
    it("sets selectedAnalysis and changes view to detail", () => {
      const mockAnalysis = createMockAnalysis();
      const action: AppAction = {
        type: "VIEW_ANALYSIS",
        payload: mockAnalysis,
      };

      const newState = appReducer(initialState, action);

      expect(newState.selectedAnalysis).toEqual(mockAnalysis);
      expect(newState.currentView).toBe("detail");
    });
  });

  describe("BACK_TO_HISTORY", () => {
    it("clears selectedAnalysis and returns to history view", () => {
      const stateWithSelection: AppState = {
        ...initialState,
        selectedAnalysis: createMockAnalysis(),
        currentView: "detail",
      };
      const action: AppAction = { type: "BACK_TO_HISTORY" };

      const newState = appReducer(stateWithSelection, action);

      expect(newState.selectedAnalysis).toBeNull();
      expect(newState.currentView).toBe("history");
    });
  });

  describe("UI Panels", () => {
    it("OPEN_SETTINGS sets showSettings to true", () => {
      const action: AppAction = { type: "OPEN_SETTINGS" };
      const newState = appReducer(initialState, action);
      expect(newState.showSettings).toBe(true);
    });

    it("CLOSE_SETTINGS sets showSettings to false", () => {
      const stateWithSettings: AppState = { ...initialState, showSettings: true };
      const action: AppAction = { type: "CLOSE_SETTINGS" };
      const newState = appReducer(stateWithSettings, action);
      expect(newState.showSettings).toBe(false);
    });

    it("OPEN_DASHBOARD sets showDashboard to true", () => {
      const action: AppAction = { type: "OPEN_DASHBOARD" };
      const newState = appReducer(initialState, action);
      expect(newState.showDashboard).toBe(true);
    });

    it("CLOSE_DASHBOARD sets showDashboard to false", () => {
      const stateWithDashboard: AppState = { ...initialState, showDashboard: true };
      const action: AppAction = { type: "CLOSE_DASHBOARD" };
      const newState = appReducer(stateWithDashboard, action);
      expect(newState.showDashboard).toBe(false);
    });
  });

  describe("SET_DARK_MODE", () => {
    it("updates darkMode state", () => {
      const action: AppAction = { type: "SET_DARK_MODE", payload: false };
      const newState = appReducer(initialState, action);
      expect(newState.darkMode).toBe(false);
    });
  });

  describe("SET_API_KEY", () => {
    it("updates apiKey state", () => {
      const action: AppAction = { type: "SET_API_KEY", payload: "new-key" };
      const newState = appReducer(initialState, action);
      expect(newState.apiKey).toBe("new-key");
    });
  });

  describe("Analysis Actions", () => {
    it("START_ANALYSIS sets analyzing to true and clears errors", () => {
      const stateWithError: AppState = {
        ...initialState,
        error: { message: "old error", suggestions: [] },
        batchSummary: "old summary",
      };
      const action: AppAction = { type: "START_ANALYSIS" };

      const newState = appReducer(stateWithError, action);

      expect(newState.analyzing).toBe(true);
      expect(newState.error).toBeNull();
      expect(newState.batchSummary).toBeNull();
    });

    it("ANALYSIS_SUCCESS sets result and clears analyzing", () => {
      const stateAnalyzing: AppState = { ...initialState, analyzing: true };
      const mockResult = createMockAnalysisResult();
      const action: AppAction = {
        type: "ANALYSIS_SUCCESS",
        payload: mockResult,
      };

      const newState = appReducer(stateAnalyzing, action);

      expect(newState.analyzing).toBe(false);
      expect(newState.analysisResult).toEqual(mockResult);
      expect(newState.error).toBeNull();
    });

    it("ANALYSIS_ERROR sets error and clears analyzing", () => {
      const stateAnalyzing: AppState = { ...initialState, analyzing: true };
      const action: AppAction = {
        type: "ANALYSIS_ERROR",
        payload: { message: "Analysis failed", suggestions: ["Try again"] },
      };

      const newState = appReducer(stateAnalyzing, action);

      expect(newState.analyzing).toBe(false);
      expect(newState.error?.message).toBe("Analysis failed");
      expect(newState.error?.suggestions).toContain("Try again");
    });

    it("CLEAR_ANALYSIS resets analysis state", () => {
      const stateWithAnalysis: AppState = {
        ...initialState,
        analysisResult: createMockAnalysisResult(),
        error: { message: "error", suggestions: [] },
        batchProgress: { total: 5, processed: 3, failed: 0 },
        batchSummary: "summary",
      };
      const action: AppAction = { type: "CLEAR_ANALYSIS" };

      const newState = appReducer(stateWithAnalysis, action);

      expect(newState.analysisResult).toBeNull();
      expect(newState.error).toBeNull();
      expect(newState.batchProgress).toBeNull();
      expect(newState.batchSummary).toBeNull();
    });
  });

  describe("Translation Actions", () => {
    it("START_TRANSLATION sets translating to true", () => {
      const action: AppAction = { type: "START_TRANSLATION" };
      const newState = appReducer(initialState, action);
      expect(newState.translating).toBe(true);
      expect(newState.error).toBeNull();
    });

    it("TRANSLATION_COMPLETE sets translating to false", () => {
      const stateTranslating: AppState = { ...initialState, translating: true };
      const action: AppAction = { type: "TRANSLATION_COMPLETE" };
      const newState = appReducer(stateTranslating, action);
      expect(newState.translating).toBe(false);
    });

    it("TRANSLATION_ERROR sets error and clears translating", () => {
      const stateTranslating: AppState = { ...initialState, translating: true };
      const action: AppAction = {
        type: "TRANSLATION_ERROR",
        payload: { message: "Translation failed", suggestions: [] },
      };

      const newState = appReducer(stateTranslating, action);

      expect(newState.translating).toBe(false);
      expect(newState.error?.message).toBe("Translation failed");
    });
  });

  describe("Batch Processing Actions", () => {
    it("START_BATCH initializes batch progress", () => {
      const action: AppAction = { type: "START_BATCH", payload: { total: 10 } };

      const newState = appReducer(initialState, action);

      expect(newState.analyzing).toBe(true);
      expect(newState.batchProgress).toEqual({
        total: 10,
        processed: 0,
        currentFile: undefined,
        failed: 0,
      });
      expect(newState.analysisResult).toBeNull();
      expect(newState.error).toBeNull();
    });

    it("BATCH_PROGRESS updates progress fields", () => {
      const stateWithBatch: AppState = {
        ...initialState,
        batchProgress: { total: 10, processed: 0, failed: 0 },
      };
      const action: AppAction = {
        type: "BATCH_PROGRESS",
        payload: { processed: 5, currentFile: "test.log", failed: 1 },
      };

      const newState = appReducer(stateWithBatch, action);

      expect(newState.batchProgress).toEqual({
        total: 10,
        processed: 5,
        currentFile: "test.log",
        failed: 1,
      });
    });

    it("BATCH_PROGRESS does nothing if no batch is active", () => {
      const action: AppAction = {
        type: "BATCH_PROGRESS",
        payload: { processed: 5 },
      };

      const newState = appReducer(initialState, action);

      expect(newState.batchProgress).toBeNull();
    });

    it("BATCH_COMPLETE sets summary and clears analyzing", () => {
      const stateWithBatch: AppState = {
        ...initialState,
        analyzing: true,
        batchProgress: { total: 10, processed: 10, failed: 2, currentFile: "last.log" },
      };
      const action: AppAction = {
        type: "BATCH_COMPLETE",
        payload: { summary: "Completed: 8 succeeded, 2 failed" },
      };

      const newState = appReducer(stateWithBatch, action);

      expect(newState.analyzing).toBe(false);
      expect(newState.batchSummary).toBe("Completed: 8 succeeded, 2 failed");
      expect(newState.batchProgress?.currentFile).toBeUndefined();
    });

    it("CLEAR_BATCH removes batch state", () => {
      const stateWithBatch: AppState = {
        ...initialState,
        batchProgress: { total: 10, processed: 10, failed: 0 },
        batchSummary: "All done",
      };
      const action: AppAction = { type: "CLEAR_BATCH" };

      const newState = appReducer(stateWithBatch, action);

      expect(newState.batchProgress).toBeNull();
      expect(newState.batchSummary).toBeNull();
    });
  });

  describe("Error Handling Actions", () => {
    it("SET_ERROR sets the error state", () => {
      const action: AppAction = {
        type: "SET_ERROR",
        payload: { message: "Something went wrong", suggestions: ["Fix it"] },
      };

      const newState = appReducer(initialState, action);

      expect(newState.error?.message).toBe("Something went wrong");
      expect(newState.error?.suggestions).toContain("Fix it");
    });

    it("CLEAR_ERROR removes the error state", () => {
      const stateWithError: AppState = {
        ...initialState,
        error: { message: "error", suggestions: [] },
      };
      const action: AppAction = { type: "CLEAR_ERROR" };

      const newState = appReducer(stateWithError, action);

      expect(newState.error).toBeNull();
    });
  });

  describe("Default case", () => {
    it("returns unchanged state for unknown actions", () => {
      const unknownAction = { type: "UNKNOWN_ACTION" } as unknown as AppAction;
      const newState = appReducer(initialState, unknownAction);
      expect(newState).toBe(initialState);
    });
  });

  describe("Initial state", () => {
    it("has correct initial values", () => {
      expect(initialState.isInitializing).toBe(true);
      expect(initialState.currentView).toBe("analyze");
      expect(initialState.showSettings).toBe(false);
      expect(initialState.showDashboard).toBe(false);
      expect(initialState.darkMode).toBe(true);
      expect(initialState.apiKey).toBe("");
      expect(initialState.analyzing).toBe(false);
      expect(initialState.analysisResult).toBeNull();
      expect(initialState.selectedAnalysis).toBeNull();
      expect(initialState.translating).toBe(false);
      expect(initialState.batchProgress).toBeNull();
      expect(initialState.batchSummary).toBeNull();
      expect(initialState.error).toBeNull();
    });
  });
});
