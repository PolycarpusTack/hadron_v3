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
