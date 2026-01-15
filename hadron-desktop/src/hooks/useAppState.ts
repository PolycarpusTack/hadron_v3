/**
 * Consolidated App State Management
 *
 * Replaces 15+ useState calls with a single useReducer for:
 * - Predictable state transitions
 * - Easier debugging (all state changes go through actions)
 * - Better testability
 * - Clearer state relationships
 */

import { useReducer, useCallback } from 'react';
import type { AnalysisResult } from '../types';
import type { Analysis } from '../services/api';

// ============================================================================
// State Types
// ============================================================================

export type View = 'analyze' | 'history' | 'detail' | 'translate';

export interface BatchProgress {
  total: number;
  processed: number;
  currentFile?: string;
  failed: number;
}

export interface ErrorState {
  message: string;
  suggestions: string[];
}

export interface AppState {
  // Initialization
  isInitializing: boolean;

  // Navigation
  currentView: View;

  // UI Panels
  showSettings: boolean;
  showDashboard: boolean;

  // Theme
  darkMode: boolean;

  // Authentication
  apiKey: string;

  // Analysis
  analyzing: boolean;
  analysisResult: AnalysisResult | null;
  selectedAnalysis: Analysis | null;

  // Translation
  translating: boolean;

  // Batch Processing
  batchProgress: BatchProgress | null;
  batchSummary: string | null;

  // Error Handling
  error: ErrorState | null;
}

// ============================================================================
// Actions
// ============================================================================

export type AppAction =
  // Initialization
  | { type: 'INIT_COMPLETE'; payload: { apiKey: string; darkMode: boolean } }

  // Navigation
  | { type: 'SET_VIEW'; payload: View }
  | { type: 'VIEW_ANALYSIS'; payload: Analysis }
  | { type: 'BACK_TO_HISTORY' }

  // UI Panels
  | { type: 'OPEN_SETTINGS' }
  | { type: 'CLOSE_SETTINGS' }
  | { type: 'OPEN_DASHBOARD' }
  | { type: 'CLOSE_DASHBOARD' }

  // Theme
  | { type: 'SET_DARK_MODE'; payload: boolean }

  // Authentication
  | { type: 'SET_API_KEY'; payload: string }

  // Analysis
  | { type: 'START_ANALYSIS' }
  | { type: 'ANALYSIS_SUCCESS'; payload: AnalysisResult }
  | { type: 'ANALYSIS_ERROR'; payload: ErrorState }
  | { type: 'CLEAR_ANALYSIS' }

  // Translation
  | { type: 'START_TRANSLATION' }
  | { type: 'TRANSLATION_COMPLETE' }
  | { type: 'TRANSLATION_ERROR'; payload: ErrorState }

  // Batch Processing
  | { type: 'START_BATCH'; payload: { total: number } }
  | { type: 'BATCH_PROGRESS'; payload: Partial<BatchProgress> }
  | { type: 'BATCH_COMPLETE'; payload: { summary: string } }
  | { type: 'CLEAR_BATCH' }

  // Error Handling
  | { type: 'SET_ERROR'; payload: ErrorState }
  | { type: 'CLEAR_ERROR' };

// ============================================================================
// Initial State
// ============================================================================

export const initialState: AppState = {
  isInitializing: true,
  currentView: 'analyze',
  showSettings: false,
  showDashboard: false,
  darkMode: true,
  apiKey: '',
  analyzing: false,
  analysisResult: null,
  selectedAnalysis: null,
  translating: false,
  batchProgress: null,
  batchSummary: null,
  error: null,
};

// ============================================================================
// Reducer
// ============================================================================

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    // Initialization
    case 'INIT_COMPLETE':
      return {
        ...state,
        isInitializing: false,
        apiKey: action.payload.apiKey,
        darkMode: action.payload.darkMode,
      };

    // Navigation
    case 'SET_VIEW':
      return {
        ...state,
        currentView: action.payload,
        // Clear analysis result when switching away from analyze view
        ...(action.payload !== 'analyze' ? {} : { analysisResult: null }),
        error: null,
      };

    case 'VIEW_ANALYSIS':
      return {
        ...state,
        selectedAnalysis: action.payload,
        currentView: 'detail',
      };

    case 'BACK_TO_HISTORY':
      return {
        ...state,
        selectedAnalysis: null,
        currentView: 'history',
      };

    // UI Panels
    case 'OPEN_SETTINGS':
      return { ...state, showSettings: true };

    case 'CLOSE_SETTINGS':
      return { ...state, showSettings: false };

    case 'OPEN_DASHBOARD':
      return { ...state, showDashboard: true };

    case 'CLOSE_DASHBOARD':
      return { ...state, showDashboard: false };

    // Theme
    case 'SET_DARK_MODE':
      return { ...state, darkMode: action.payload };

    // Authentication
    case 'SET_API_KEY':
      return { ...state, apiKey: action.payload };

    // Analysis
    case 'START_ANALYSIS':
      return {
        ...state,
        analyzing: true,
        error: null,
        batchSummary: null,
      };

    case 'ANALYSIS_SUCCESS':
      return {
        ...state,
        analyzing: false,
        analysisResult: action.payload,
        error: null,
      };

    case 'ANALYSIS_ERROR':
      return {
        ...state,
        analyzing: false,
        error: action.payload,
      };

    case 'CLEAR_ANALYSIS':
      return {
        ...state,
        analysisResult: null,
        error: null,
        batchProgress: null,
        batchSummary: null,
      };

    // Translation
    case 'START_TRANSLATION':
      return {
        ...state,
        translating: true,
        error: null,
      };

    case 'TRANSLATION_COMPLETE':
      return {
        ...state,
        translating: false,
      };

    case 'TRANSLATION_ERROR':
      return {
        ...state,
        translating: false,
        error: action.payload,
      };

    // Batch Processing
    case 'START_BATCH':
      return {
        ...state,
        analyzing: true,
        analysisResult: null,
        error: null,
        batchSummary: null,
        batchProgress: {
          total: action.payload.total,
          processed: 0,
          currentFile: undefined,
          failed: 0,
        },
      };

    case 'BATCH_PROGRESS':
      return {
        ...state,
        batchProgress: state.batchProgress
          ? { ...state.batchProgress, ...action.payload }
          : null,
      };

    case 'BATCH_COMPLETE':
      return {
        ...state,
        analyzing: false,
        batchProgress: state.batchProgress
          ? { ...state.batchProgress, currentFile: undefined }
          : null,
        batchSummary: action.payload.summary,
      };

    case 'CLEAR_BATCH':
      return {
        ...state,
        batchProgress: null,
        batchSummary: null,
      };

    // Error Handling
    case 'SET_ERROR':
      return { ...state, error: action.payload };

    case 'CLEAR_ERROR':
      return { ...state, error: null };

    default:
      return state;
  }
}

// ============================================================================
// Hook
// ============================================================================

export function useAppState() {
  const [state, dispatch] = useReducer(appReducer, initialState);

  // Memoized action creators for better performance
  const actions = {
    // Initialization
    initComplete: useCallback(
      (apiKey: string, darkMode: boolean) =>
        dispatch({ type: 'INIT_COMPLETE', payload: { apiKey, darkMode } }),
      []
    ),

    // Navigation
    setView: useCallback(
      (view: View) => dispatch({ type: 'SET_VIEW', payload: view }),
      []
    ),
    viewAnalysis: useCallback(
      (analysis: Analysis) => dispatch({ type: 'VIEW_ANALYSIS', payload: analysis }),
      []
    ),
    backToHistory: useCallback(
      () => dispatch({ type: 'BACK_TO_HISTORY' }),
      []
    ),

    // UI Panels
    openSettings: useCallback(() => dispatch({ type: 'OPEN_SETTINGS' }), []),
    closeSettings: useCallback(() => dispatch({ type: 'CLOSE_SETTINGS' }), []),
    openDashboard: useCallback(() => dispatch({ type: 'OPEN_DASHBOARD' }), []),
    closeDashboard: useCallback(() => dispatch({ type: 'CLOSE_DASHBOARD' }), []),

    // Theme
    setDarkMode: useCallback(
      (darkMode: boolean) => dispatch({ type: 'SET_DARK_MODE', payload: darkMode }),
      []
    ),

    // Authentication
    setApiKey: useCallback(
      (apiKey: string) => dispatch({ type: 'SET_API_KEY', payload: apiKey }),
      []
    ),

    // Analysis
    startAnalysis: useCallback(() => dispatch({ type: 'START_ANALYSIS' }), []),
    analysisSuccess: useCallback(
      (result: AnalysisResult) => dispatch({ type: 'ANALYSIS_SUCCESS', payload: result }),
      []
    ),
    analysisError: useCallback(
      (message: string, suggestions: string[] = []) =>
        dispatch({ type: 'ANALYSIS_ERROR', payload: { message, suggestions } }),
      []
    ),
    clearAnalysis: useCallback(() => dispatch({ type: 'CLEAR_ANALYSIS' }), []),

    // Translation
    startTranslation: useCallback(() => dispatch({ type: 'START_TRANSLATION' }), []),
    translationComplete: useCallback(() => dispatch({ type: 'TRANSLATION_COMPLETE' }), []),
    translationError: useCallback(
      (message: string, suggestions: string[] = []) =>
        dispatch({ type: 'TRANSLATION_ERROR', payload: { message, suggestions } }),
      []
    ),

    // Batch Processing
    startBatch: useCallback(
      (total: number) => dispatch({ type: 'START_BATCH', payload: { total } }),
      []
    ),
    batchProgress: useCallback(
      (progress: Partial<BatchProgress>) =>
        dispatch({ type: 'BATCH_PROGRESS', payload: progress }),
      []
    ),
    batchComplete: useCallback(
      (summary: string) => dispatch({ type: 'BATCH_COMPLETE', payload: { summary } }),
      []
    ),
    clearBatch: useCallback(() => dispatch({ type: 'CLEAR_BATCH' }), []),

    // Error Handling
    setError: useCallback(
      (message: string, suggestions: string[] = []) =>
        dispatch({ type: 'SET_ERROR', payload: { message, suggestions } }),
      []
    ),
    clearError: useCallback(() => dispatch({ type: 'CLEAR_ERROR' }), []),
  };

  return { state, actions, dispatch };
}

export default useAppState;
