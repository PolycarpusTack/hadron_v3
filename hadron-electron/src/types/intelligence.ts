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
