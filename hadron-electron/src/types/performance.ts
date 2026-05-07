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
