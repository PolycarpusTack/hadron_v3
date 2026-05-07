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
