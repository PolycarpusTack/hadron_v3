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

// ── WhatsOn Enhanced Analysis ──────────────────────────────────────────────

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

// ── Crash Signatures ───────────────────────────────────────────────────────

export interface CrashSignature {
  hash: string;
  canonical: string;
  components: SignatureComponents;
  firstSeen: string;
  lastSeen: string;
  occurrenceCount: number;
  linkedTicket?: string;
  linkedTicketUrl?: string;
  status: SignatureStatusType;
  statusMetadata?: string;
}

export interface SignatureComponents {
  exceptionType: string;
  applicationFrames: string[];
  affectedModule?: string;
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

// ── Sensitive Content ──────────────────────────────────────────────────────

export interface SensitiveContentResult {
  has_sensitive: boolean;
  warnings: string[];
  detected_types: string[]; // "email", "ip", "token", "path", "credentials"
}

// ── Analysis Progress ──────────────────────────────────────────────────────

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

export interface AnalysisProgress {
  phase: AnalysisPhase;
  progress: number; // 0-100
  message: string;
  current_step?: number;
  total_steps?: number;
}

// ── Export Types ───────────────────────────────────────────────────────────

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

export interface ExportSection {
  id: string;
  label: string;
  content: string;
}

export interface ExportSource {
  sourceType: "crash" | "code" | "sentry" | "jira" | "performance";
  sourceName: string;
  defaultTitle: string;
  sections: (ExportSection & { defaultOn: boolean })[];
}

export interface GenericExportRequest {
  source_type: string;
  source_name: string;
  format: string;
  audience?: ReportAudience;
  title?: string;
  sections: ExportSection[];
  footer_text?: string;
}

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
