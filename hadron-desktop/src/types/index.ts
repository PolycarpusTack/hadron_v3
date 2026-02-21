/**
 * TypeScript type definitions for Hadron Crash Analyzer
 */

export interface AnalysisResult {
  // Core fields
  id: number;
  filename: string;
  file_size_kb: number;

  // Crash data
  error_type: string;
  error_message?: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  component?: string;
  stack_trace?: string;

  // AI analysis
  root_cause: string;
  suggested_fixes: string; // JSON string from backend
  confidence?: "HIGH" | "MEDIUM" | "LOW";

  // Metadata
  analyzed_at: string;
  ai_model: string;
  ai_provider?: string;
  tokens_used: number;
  cost: number;
  was_truncated: boolean;

  // Phase 2: Just the essentials
  is_favorite: boolean;
  view_count: number;
  analysis_duration_ms?: number;

  // WHATS'ON Enhanced fields
  full_data?: string; // JSON string containing WhatsOnEnhancedAnalysis or QuickAnalysis
  analysis_type?: "complete" | "specialized" | "whatson" | "comprehensive" | "quick" | "performance" | "code" | "jira_ticket" | "sentry";
}

export interface Settings {
  apiKey: string;
  model: string;
  maxFileSize: number;
}

export type Severity = "critical" | "high" | "medium" | "low";

// ============================================================================
// WHATS'ON Enhanced Analysis Types
// ============================================================================

export type AnalysisType =
  | "complete"
  | "specialized"
  | "whatson"
  | "comprehensive"
  | "quick"
  | "performance"
  | "code"
  | "jira_ticket"
  | "sentry";

export interface WhatsOnAnalysisSummary {
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  category: "scheduling" | "playout" | "database" | "memory" | "integration" | "ui" | "rights" | "timing" | "other";
  confidence: "high" | "medium" | "low";
  affectedWorkflow?: string;
}

export interface WhatsOnRootCause {
  technical: string;
  plainEnglish: string;
  affectedMethod: string;
  affectedModule: string;
  triggerCondition?: string;
}

export interface UserScenarioStep {
  step: number;
  action: string;
  details?: string;
  isCrashPoint: boolean;
}

export interface WhatsOnUserScenario {
  description: string;
  workflow?: string;
  steps: UserScenarioStep[];
  expectedResult: string;
  actualResult: string;
  reproductionLikelihood: "always" | "often" | "sometimes" | "rarely" | "unknown";
}

export interface CodeChange {
  file: string;
  description: string;
  before?: string;
  after?: string;
  priority: "P0" | "P1" | "P2";
}

export interface WhatsOnSuggestedFix {
  summary: string;
  reasoning: string;
  explanation?: string;
  codeChanges: CodeChange[];
  complexity: "simple" | "moderate" | "complex";
  estimatedEffort: "hours" | "days" | "weeks";
  riskLevel: "low" | "medium" | "high";
}

export interface SystemWarning {
  source: "memory" | "database" | "process" | "network" | "configuration" | "other";
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  recommendation?: string;
  contributedToCrash: boolean;
}

export interface AffectedFeature {
  feature: string;
  module: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low";
}

export interface WhatsOnImpactAnalysis {
  dataAtRisk: "none" | "low" | "moderate" | "high" | "critical";
  dataRiskDescription?: string;
  directlyAffected: AffectedFeature[];
  potentiallyAffected: AffectedFeature[];
}

export interface TestScenario {
  id: string;
  name: string;
  priority: "P0" | "P1" | "P2";
  type: "regression" | "smoke" | "integration" | "unit";
  description: string;
  steps: string;
  expectedResult: string;
  dataRequirements?: string;
}

export interface EnvironmentInfo {
  application?: {
    version?: string;
    build?: string;
    configuration?: string;
  };
  platform?: {
    os?: string;
    memory?: string;
    user?: string;
  };
  database?: {
    type?: string;
    connectionInfo?: string;
    sessionState?: string;
  };
}

export interface ReceiverContext {
  class: string;
  state?: string;
  description?: string;
}

export interface ArgumentInfo {
  name: string;
  value?: string;
  type?: string;
}

export interface RelatedObject {
  name: string;
  class: string;
  relationship?: string;
}

export interface ContextInfo {
  receiver?: ReceiverContext;
  arguments?: ArgumentInfo[];
  relatedObjects?: RelatedObject[];
}

export interface MemorySpace {
  used?: string;
  total?: string;
  percentUsed?: number;
}

export interface MemoryAnalysis {
  oldSpace?: MemorySpace;
  newSpace?: MemorySpace;
  permSpace?: MemorySpace;
  warnings?: string[];
}

export interface DatabaseConnection {
  name: string;
  status: string;
  database?: string;
}

export interface DatabaseSession {
  id: string;
  status: string;
  lastOperation?: string;
}

export interface DatabaseAnalysis {
  connections?: DatabaseConnection[];
  activeSessions?: DatabaseSession[];
  warnings?: string[];
  transactionState?: "open" | "committed" | "rolled_back" | "unknown";
}

export interface StackFrame {
  index: number;
  method: string;
  type: "error" | "application" | "framework" | "library";
  isErrorOrigin?: boolean;
  context?: string;
}

export interface StackTraceAnalysis {
  frames: StackFrame[];
  totalFrames: number;
  errorFrame?: string;
}

export interface WhatsOnEnhancedAnalysis {
  summary: WhatsOnAnalysisSummary;
  rootCause: WhatsOnRootCause;
  userScenario: WhatsOnUserScenario;
  suggestedFix: WhatsOnSuggestedFix;
  systemWarnings: SystemWarning[];
  impactAnalysis: WhatsOnImpactAnalysis;
  testScenarios: TestScenario[];
  environment?: EnvironmentInfo;
  context?: ContextInfo;
  memoryAnalysis?: MemoryAnalysis;
  databaseAnalysis?: DatabaseAnalysis;
  stackTrace?: StackTraceAnalysis;
}

// ============================================================================
// Crash Signature Types (Phase 1 Addendum)
// ============================================================================

/**
 * A crash signature uniquely identifies a type of crash
 * Independent of when/where/who experienced it
 */
export interface CrashSignature {
  /** Short hash (first 12 chars of SHA256) */
  hash: string;
  /** Human-readable canonical form */
  canonical: string;
  /** Components used to build the signature */
  components: SignatureComponents;
  /** First time this signature was seen */
  firstSeen: string;
  /** Last time this signature was seen */
  lastSeen: string;
  /** Number of occurrences */
  occurrenceCount: number;
  /** Linked JIRA ticket ID */
  linkedTicket?: string;
  /** Linked JIRA ticket URL */
  linkedTicketUrl?: string;
  /** Current status */
  status: SignatureStatusType;
  /** Status metadata (e.g., version for fixed status) */
  statusMetadata?: string;
}

export interface SignatureComponents {
  /** The exception class name */
  exceptionType: string;
  /** Top N application-level method names (normalized) */
  applicationFrames: string[];
  /** Primary affected module (PSI, BM, PL, WOn, EX) */
  affectedModule?: string;
  /** Database backend if relevant */
  databaseBackend?: "Oracle" | "PostgreSQL" | "Unknown";
}

export type SignatureStatusType =
  | "new"
  | "investigating"
  | "fix_in_progress"
  | "fixed"
  | "wont_fix"
  | "duplicate";

export interface SignatureRegistrationResult {
  signature: CrashSignature;
  isNew: boolean;
  occurrenceCount: number;
  linkedTicket?: string;
}

export interface CrashFileSummary {
  id: number;
  filename: string;
  analyzedAt: string;
  severity?: string;
}

export interface SignatureOccurrences {
  signature: CrashSignature;
  files: CrashFileSummary[];
}

// ============================================================================
// Sensitive Content Detection Types
// ============================================================================

/**
 * Result of checking content for sensitive data
 */
export interface SensitiveContentResult {
  has_sensitive: boolean;
  warnings: string[];
  detected_types: string[]; // "email", "ip", "token", "path", "credentials"
}

// ============================================================================
// Analysis Progress Types
// ============================================================================

/**
 * Phases of the analysis process
 */
export type AnalysisPhase =
  | "reading"
  | "planning"
  | "extracting"
  | "chunking"
  | "analyzing"
  | "synthesizing"
  | "saving"
  | "complete"
  | "failed";

/**
 * Progress update for analysis operations
 */
export interface AnalysisProgress {
  phase: AnalysisPhase;
  progress: number; // 0-100
  message: string;
  current_step?: number;
  total_steps?: number;
}

// ============================================================================
// Report Audience & Export Types
// ============================================================================

export type ReportAudience = "technical" | "support" | "customer" | "executive";

export interface ExportRequest {
  crash_content: string;
  file_name: string;
  format: string;
  audience?: ReportAudience;
  title?: string;
  include_sections?: string[];
  footer_text?: string;
}

export interface MultiExportRequest {
  crash_content: string;
  file_name: string;
  formats: string[];
  audience?: ReportAudience;
  title?: string;
  include_sections?: string[];
  footer_text?: string;
}

export interface ExportResponse {
  content: string;
  suggested_filename: string;
  format: string;
}

// ============================================================================
// Pattern Types
// ============================================================================

export interface PatternSummary {
  id: string;
  name: string;
  category: string;
  enabled: boolean;
  priority: number;
}

export interface PatternDetail extends PatternSummary {
  description?: string;
  tags: string[];
  suggested_fix?: string;
  documentation_url?: string;
}

// ============================================================================
// Database Admin Types
// ============================================================================

export interface DatabaseInfo {
  schema_version: number;
  analyses_count: number;
  translations_count: number;
  favorites_count: number;
  needs_migration: boolean;
  database_size_bytes?: number;
  last_analysis_at?: string;
}

// ============================================================================
// Export Format & Audience Options
// ============================================================================

export interface ExportFormatOption {
  id: string;
  name: string;
  extension: string;
  description: string;
}

export interface AudienceOption {
  id: ReportAudience;
  name: string;
  description: string;
}

// ============================================================================
// Code Analyzer Types
// ============================================================================

export type CodeAnalyzerTab = 'overview' | 'walkthrough' | 'issues' | 'optimized' | 'quality' | 'learn';

export interface CodeAnalysisResult {
  summary: string;
  issues: CodeIssue[];
  walkthrough: WalkthroughSection[];
  optimizedCode: string | null;
  qualityScores: CodeQualityScores;
  glossary: GlossaryTerm[];
}

export interface CodeIssue {
  id: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'security' | 'performance' | 'error' | 'best-practice';
  line: number;
  title: string;
  description: string;
  technical: string;
  fix: string;
  complexity: string;
  impact?: string;
}

export interface WalkthroughSection {
  lines: string;
  title: string;
  code: string;
  whatItDoes: string;
  whyItMatters: string;
  evidence: string;
  dependencies: CodeDependency[];
  impact: string;
  testability: string;
  eli5: string;
  quality: string;
}

export interface CodeDependency {
  name: string;
  type: string;
  note: string;
}

export interface CodeQualityScores {
  overall: number;
  security: number;
  performance: number;
  maintainability: number;
  bestPractices: number;
}

export interface GlossaryTerm {
  term: string;
  definition: string;
}

export interface CodeInput {
  content: string;
  filename: string;
  language: string;
}

// ============================================================================
// Performance Trace Analyzer Types
// ============================================================================

export interface PerformanceHeader {
  samples: number;
  avgMsPerSample: number;
  scavenges: number;
  incGCs: number;
  stackSpills: number;
  markStackOverflows: number;
  weakListOverflows: number;
  jitCacheSpills: number;
  activeTime: number;
  otherProcesses: number;
  realTime: number;
  profilingOverhead: number;
}

export interface DerivedMetrics {
  cpuUtilization: number;
  smalltalkActivityRatio: number;
  sampleDensity: number;
  gcPressure: number;
}

export interface ProcessInfo {
  name: string;
  priority: number | string;
  percentage: number;
  status: 'normal' | 'warning' | 'error';
}

export interface TopMethod {
  method: string;
  percentage: number;
  category: string;
}

export interface DetectedPattern {
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  description: string;
  confidence: number;
}

export interface PerformanceUserScenario {
  trigger: string;
  action: string;
  context: string;
  impact: string;
  additionalFactors: string[];
}

export interface PerformanceRecommendation {
  type: 'optimization' | 'workaround' | 'investigation' | 'configuration' | 'documentation';
  priority: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  effort: string;
}

export interface PerformanceAnalysisResult {
  filename: string;
  user: string;
  timestamp: string;
  header: PerformanceHeader;
  derived: DerivedMetrics;
  processes: ProcessInfo[];
  topMethods: TopMethod[];
  patterns: DetectedPattern[];
  scenario: PerformanceUserScenario;
  recommendations: PerformanceRecommendation[];
  overallSeverity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  summary: string;
}

// ============================================================================
// Tag Types (History Enhancement)
// ============================================================================

/**
 * User-defined tag for organizing analyses and translations
 */
export interface Tag {
  id: number;
  name: string;
  color: string;
  usageCount: number;
  createdAt: string;
}

/**
 * Analysis note - user comments on an analysis
 */
export interface AnalysisNote {
  id: number;
  analysisId: number;
  content: string;
  createdAt: string;
  updatedAt?: string;
}

/**
 * Trend data point for analytics charts
 */
export interface TrendDataPoint {
  period: string;
  total: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  whatsonCount: number;
  completeCount: number;
  specializedCount: number;
  totalCost: number;
}

/**
 * Error pattern count for duplicate detection
 */
export interface ErrorPatternCount {
  signature: string;
  errorType: string;
  component: string | null;
  count: number;
}

/**
 * Predefined color palette for tags
 */
export const TAG_COLORS = {
  red: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30', hex: '#EF4444' },
  orange: { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30', hex: '#F97316' },
  amber: { bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500/30', hex: '#F59E0B' },
  yellow: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30', hex: '#EAB308' },
  lime: { bg: 'bg-lime-500/20', text: 'text-lime-400', border: 'border-lime-500/30', hex: '#84CC16' },
  green: { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30', hex: '#22C55E' },
  emerald: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-500/30', hex: '#10B981' },
  teal: { bg: 'bg-teal-500/20', text: 'text-teal-400', border: 'border-teal-500/30', hex: '#14B8A6' },
  cyan: { bg: 'bg-cyan-500/20', text: 'text-cyan-400', border: 'border-cyan-500/30', hex: '#5066e9' },
  sky: { bg: 'bg-sky-500/20', text: 'text-sky-400', border: 'border-sky-500/30', hex: '#5066e9' },
  blue: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30', hex: '#5420e8' },
  indigo: { bg: 'bg-indigo-500/20', text: 'text-indigo-400', border: 'border-indigo-500/30', hex: '#6438e0' },
  violet: { bg: 'bg-violet-500/20', text: 'text-violet-400', border: 'border-violet-500/30', hex: '#9b8ec8' },
  purple: { bg: 'bg-purple-500/20', text: 'text-purple-400', border: 'border-purple-500/30', hex: '#7e6db6' },
  fuchsia: { bg: 'bg-fuchsia-500/20', text: 'text-fuchsia-400', border: 'border-fuchsia-500/30', hex: '#D946EF' },
  pink: { bg: 'bg-pink-500/20', text: 'text-pink-400', border: 'border-pink-500/30', hex: '#EC4899' },
  rose: { bg: 'bg-rose-500/20', text: 'text-rose-400', border: 'border-rose-500/30', hex: '#F43F5E' },
  gray: { bg: 'bg-gray-500/20', text: 'text-gray-400', border: 'border-gray-500/30', hex: '#6B7280' },
} as const;

export type TagColorKey = keyof typeof TAG_COLORS;

/**
 * Helper to get color classes from hex color
 */
export function getTagColorClasses(hexColor: string): { bg: string; text: string; border: string } {
  // Find matching color by hex value
  const entry = Object.values(TAG_COLORS).find(c => c.hex.toLowerCase() === hexColor.toLowerCase());
  if (entry) {
    return { bg: entry.bg, text: entry.text, border: entry.border };
  }
  // Fallback to gray if no match
  return TAG_COLORS.gray;
}

// ============================================================================
// Advanced Filtering Types (History Enhancement)
// ============================================================================

/**
 * Date range presets for quick filtering
 */
export type DateRangePreset =
  | 'today'
  | 'yesterday'
  | 'last7days'
  | 'last30days'
  | 'thisMonth'
  | 'lastMonth'
  | 'allTime'
  | 'custom';

/**
 * Date range filter configuration
 */
export interface DateRangeFilter {
  preset: DateRangePreset;
  customRange?: {
    start: string; // ISO 8601 date string
    end: string;
  };
}

/**
 * Tag filter configuration
 */
export interface TagFilter {
  mode: 'any' | 'all'; // OR vs AND
  tagIds: number[];
  excludeTagIds?: number[];
}

/**
 * Cost filter configuration
 */
export interface CostFilter {
  min?: number;
  max?: number;
  preset?: 'under1cent' | 'under10cents' | 'over10cents' | 'custom';
}

/**
 * Combined filter state for history view
 */
export interface HistoryFilters {
  // Text search
  search: string;

  // Severity filter
  severities: string[]; // ['critical', 'high', 'medium', 'low']

  // Type filters
  analysisTypes: string[]; // ['whatson', 'complete', 'specialized']
  analysisModes: string[]; // ['Quick', 'Quick (Extracted)', 'Deep Scan']

  // Date range
  dateRange: DateRangeFilter;

  // Tags
  tags: TagFilter;

  // Cost
  cost: CostFilter;

  // View options
  showArchived: boolean;
  favoritesOnly: boolean;

  // Sort
  sortBy: 'date' | 'severity' | 'cost' | 'fileSize' | 'filename';
  sortOrder: 'asc' | 'desc';
}

/**
 * API request options for filtered analyses
 */
export interface AdvancedFilterOptions {
  search?: string;
  severities?: string[];
  analysisTypes?: string[];
  analysisModes?: string[];
  tagIds?: number[];
  tagMode?: 'any' | 'all';
  dateFrom?: string;
  dateTo?: string;
  costMin?: number;
  costMax?: number;
  includeArchived?: boolean;
  favoritesOnly?: boolean;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

/**
 * Paginated filter results
 */
export interface FilteredResults<T> {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

/**
 * Result from bulk operations
 */
export interface BulkOperationResult {
  successCount: number;
  totalRequested: number;
}

/**
 * Default filter state
 */
export const DEFAULT_HISTORY_FILTERS: HistoryFilters = {
  search: '',
  severities: [],
  analysisTypes: [],
  analysisModes: [],
  dateRange: { preset: 'allTime' },
  tags: { mode: 'any', tagIds: [] },
  cost: {},
  showArchived: false,
  favoritesOnly: false,
  sortBy: 'date',
  sortOrder: 'desc',
};

/**
 * Convert HistoryFilters to API request options
 */
export function filtersToApiOptions(filters: HistoryFilters, limit = 50, offset = 0): AdvancedFilterOptions {
  const options: AdvancedFilterOptions = {
    limit,
    offset,
    sortBy: filters.sortBy,
    sortOrder: filters.sortOrder,
    includeArchived: filters.showArchived,
    favoritesOnly: filters.favoritesOnly,
  };

  if (filters.search) {
    options.search = filters.search;
  }

  if (filters.severities.length > 0) {
    options.severities = filters.severities;
  }

  if (filters.analysisTypes.length > 0) {
    options.analysisTypes = filters.analysisTypes;
  }

  if (filters.analysisModes.length > 0) {
    options.analysisModes = filters.analysisModes;
  }

  if (filters.tags.tagIds.length > 0) {
    options.tagIds = filters.tags.tagIds;
    options.tagMode = filters.tags.mode;
  }

  // Convert date range preset to actual dates
  const { dateFrom, dateTo } = getDateRangeFromPreset(filters.dateRange);
  if (dateFrom) options.dateFrom = dateFrom;
  if (dateTo) options.dateTo = dateTo;

  // Cost filter
  if (filters.cost.min !== undefined) {
    options.costMin = filters.cost.min;
  }
  if (filters.cost.max !== undefined) {
    options.costMax = filters.cost.max;
  }

  return options;
}

/**
 * Convert date range preset to actual ISO date strings
 */
export function getDateRangeFromPreset(
  dateRange: DateRangeFilter
): { dateFrom?: string; dateTo?: string } {
  const now = new Date();
  const startOfDay = (d: Date) => {
    const copy = new Date(d);
    copy.setHours(0, 0, 0, 0);
    return copy;
  };
  const endOfDay = (d: Date) => {
    const copy = new Date(d);
    copy.setHours(23, 59, 59, 999);
    return copy;
  };

  switch (dateRange.preset) {
    case 'today':
      return {
        dateFrom: startOfDay(now).toISOString(),
        dateTo: endOfDay(now).toISOString(),
      };
    case 'yesterday': {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      return {
        dateFrom: startOfDay(yesterday).toISOString(),
        dateTo: endOfDay(yesterday).toISOString(),
      };
    }
    case 'last7days': {
      const weekAgo = new Date(now);
      weekAgo.setDate(weekAgo.getDate() - 7);
      return {
        dateFrom: startOfDay(weekAgo).toISOString(),
      };
    }
    case 'last30days': {
      const monthAgo = new Date(now);
      monthAgo.setDate(monthAgo.getDate() - 30);
      return {
        dateFrom: startOfDay(monthAgo).toISOString(),
      };
    }
    case 'thisMonth': {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return {
        dateFrom: startOfMonth.toISOString(),
      };
    }
    case 'lastMonth': {
      const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
      return {
        dateFrom: startOfLastMonth.toISOString(),
        dateTo: endOfLastMonth.toISOString(),
      };
    }
    case 'custom':
      if (dateRange.customRange) {
        return {
          dateFrom: dateRange.customRange.start,
          dateTo: dateRange.customRange.end,
        };
      }
      return {};
    case 'allTime':
    default:
      return {};
  }
}

// ============================================================================
// Intelligence Platform Types (Phase 1-2)
// ============================================================================

// Feedback types
export interface AnalysisFeedback {
  id?: number;
  analysisId: number;
  feedbackType: 'accept' | 'reject' | 'edit' | 'rating';
  fieldName?: string;
  originalValue?: string;
  newValue?: string;
  rating?: number;
  feedbackAt?: string;
}

// Gold analysis types
export interface GoldAnalysis {
  id: number;
  sourceAnalysisId?: number;
  sourceType: 'crash' | 'ticket' | 'manual';
  errorSignature: string;
  crashContentHash?: string;
  rootCause: string;
  suggestedFixes: string; // JSON array string from Rust backend
  component?: string;
  severity?: string;
  validationStatus: 'pending' | 'verified' | 'rejected';
  createdAt: string;
  verifiedBy?: string;
  timesReferenced: number;
  successRate?: number;
}

// RAG types
export interface RetrievalChunk {
  id: number;
  sourceType: 'analysis' | 'gold' | 'ticket' | 'documentation';
  sourceId: number;
  chunkIndex: number;
  content: string;
  metadata: ChunkMetadata;
  score?: number;
}

export interface ChunkMetadata {
  component?: string;
  severity?: string;
  errorType?: string;
  version?: string;
}

export interface RetrievalResult {
  chunks: RetrievalChunk[];
  query: string;
  totalFound: number;
}

// RAGContext and SimilarCase are defined in services/rag.ts (snake_case, matches backend)

// ============================================================================
// Sentry Integration Types
// ============================================================================

export interface SentryConfig {
  enabled: boolean;
  baseUrl: string;
  organization: string;
  defaultProject: string;
}

export interface SentryProjectInfo {
  id: string;
  slug: string;
  name: string;
  platform: string | null;
  organization: { slug: string };
}

export interface SentryTestResponse {
  success: boolean;
  message: string;
  projects: SentryProjectInfo[] | null;
}

export interface SentryIssue {
  id: string;
  shortId: string;
  title: string;
  culprit: string | null;
  level: "error" | "warning" | "info" | "fatal" | "debug";
  status: "unresolved" | "resolved" | "ignored";
  platform: string | null;
  count: string | null;
  userCount: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
  permalink: string | null;
  metadata: Record<string, unknown> | null;
  project?: { id: string; slug: string; name?: string };
}

export interface SentryIssueList {
  issues: SentryIssue[];
  nextCursor: string | null;
}

export interface SentryEvent {
  eventId: string | null;
  title: string | null;
  message: string | null;
  platform: string | null;
  tags: SentryTag[] | null;
  contexts: Record<string, unknown> | null;
  entries: Record<string, unknown>[] | null;
}

export interface SentryTag {
  key: string;
  value: string;
}

// ============================================================================
// Release Notes Generator Types
// ============================================================================

export type ReleaseNotesContentType = "features" | "fixes" | "both";

export type ReleaseNotesStatus = "draft" | "in_review" | "approved" | "published" | "archived";

export interface ReleaseNotesConfig {
  fixVersion: string;
  contentType: ReleaseNotesContentType;
  projectKey?: string;
  jqlFilter?: string;
  moduleFilter?: string[];
  aiEnrichment: AiEnrichmentConfig;
}

export interface AiEnrichmentConfig {
  rewriteDescriptions: boolean;
  generateKeywords: boolean;
  classifyModules: boolean;
  detectBreakingChanges: boolean;
}

export interface ReleaseNotesDraft {
  id: number;
  fixVersion: string;
  contentType: string;
  title: string;
  markdownContent: string;
  originalAiContent: string | null;
  ticketKeys: string;
  ticketCount: number;
  jqlFilter: string | null;
  moduleFilter: string | null;
  aiModel: string;
  aiProvider: string;
  tokensUsed: number;
  cost: number;
  generationDurationMs: number | null;
  aiInsights: string | null;
  status: ReleaseNotesStatus;
  checklistState: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  version: number;
  parentId: number | null;
  isManualEdit: boolean;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface ReleaseNotesSummary {
  id: number;
  fixVersion: string;
  contentType: string;
  title: string;
  ticketCount: number;
  status: ReleaseNotesStatus;
  version: number;
  isManualEdit: boolean;
  aiModel: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReleaseNotesAiInsights {
  qualityScore: number;
  suggestions: string[];
  moduleBreakdown: Record<string, number>;
  ticketCoverage: number;
  breakingChanges: string[];
}

export interface ReleaseNotesProgress {
  phase: ReleaseNotesPhase;
  progress: number;
  message: string;
  requestId?: string | null;
}

export type ReleaseNotesPhase =
  | "fetching_tickets"
  | "classifying_tickets"
  | "enriching_content"
  | "generating_draft"
  | "applying_style_guide"
  | "computing_insights"
  | "saving"
  | "complete"
  | "failed";

export interface ReleaseNoteTicketPreview {
  key: string;
  summary: string;
  issueType: string;
  priority: string;
  status: string;
  components: string[];
  labels: string[];
}

export interface JiraFixVersion {
  id: string;
  name: string;
  description: string | null;
  released: boolean;
  archived: boolean;
  releaseDate: string | null;
}

export interface ReleaseNotesChecklistItem {
  id: string;
  label: string;
  checked: boolean;
  autoDetected?: boolean;
}

export type ReleaseNotesExportFormat = "markdown" | "confluence" | "html";

// Style Compliance
export interface ComplianceReport {
  terminologyViolations: TerminologyViolation[];
  structureViolations: StructureViolation[];
  screenshotSuggestions: ScreenshotSuggestion[];
  score: number;
  tokensUsed: number;
  cost: number;
}

export interface TerminologyViolation {
  lineContext: string;
  violation: string;
  suggestedFix: string;
  ruleReference: string;
}

export interface StructureViolation {
  section: string;
  violation: string;
  suggestedFix: string;
  ruleReference: string;
}

export interface ScreenshotSuggestion {
  ticketKey: string;
  description: string;
  placementHint: string;
  inlinePlaceholder: string;
}
