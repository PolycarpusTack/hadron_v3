export interface DatabaseInfo {
  schema_version: number;
  analyses_count: number;
  translations_count: number;
  favorites_count: number;
  needs_migration: boolean;
  database_size_bytes?: number;
  last_analysis_at?: string;
}
