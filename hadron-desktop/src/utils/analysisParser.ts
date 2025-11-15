/**
 * Utility functions for parsing multi-part analysis outputs
 */

export interface AnalysisPart {
  title: string;
  content: string;
  index: number;
}

export type AnalysisType = 'complete' | 'specialized' | 'simple';

export interface ParsedAnalysis {
  type: AnalysisType;
  parts: AnalysisPart[];
  rawContent: string;
}

/**
 * Detects the type of analysis based on the root_cause content
 */
export function detectAnalysisType(rootCause: string): AnalysisType {
  const upperContent = rootCause.toUpperCase();

  if (upperContent.includes('# COMPLETE ANALYSIS') || upperContent.includes('## PART 1:')) {
    return 'complete';
  }

  if (upperContent.includes('# SPECIALIZED ANALYSES SUITE') || upperContent.includes('## ANALYSIS 1:')) {
    return 'specialized';
  }

  return 'simple';
}

/**
 * Parses complete analysis (10-part structure) into separate parts
 */
function parseCompleteAnalysis(rootCause: string): AnalysisPart[] {
  const parts: AnalysisPart[] = [];

  // Split by ## PART markers
  const partRegex = /## PART (\d+): (.+?)(?=\n## PART \d+:|$)/gs;
  const matches = [...rootCause.matchAll(partRegex)];

  if (matches.length === 0) {
    // Fallback: return entire content as single part
    return [{
      title: 'Complete Analysis',
      content: rootCause,
      index: 0
    }];
  }

  matches.forEach((match) => {
    const partNumber = parseInt(match[1]);
    const titleLine = match[2].split('\n')[0].trim();
    const content = match[0].replace(/## PART \d+: .+?\n/, '').trim();

    parts.push({
      title: `Part ${partNumber}: ${titleLine}`,
      content,
      index: partNumber - 1
    });
  });

  return parts;
}

/**
 * Parses specialized analysis (8-part suite) into separate analyses
 */
function parseSpecializedAnalysis(rootCause: string): AnalysisPart[] {
  const parts: AnalysisPart[] = [];

  // Split by ## ANALYSIS markers
  const analysisRegex = /## ANALYSIS (\d+): (.+?)(?=\n## ANALYSIS \d+:|$)/gs;
  const matches = [...rootCause.matchAll(analysisRegex)];

  if (matches.length === 0) {
    // Fallback: return entire content as single part
    return [{
      title: 'Specialized Analyses Suite',
      content: rootCause,
      index: 0
    }];
  }

  matches.forEach((match) => {
    const analysisNumber = parseInt(match[1]);
    const titleLine = match[2].split('\n')[0].trim();
    const content = match[0].replace(/## ANALYSIS \d+: .+?\n/, '').trim();

    parts.push({
      title: `${analysisNumber}. ${titleLine}`,
      content,
      index: analysisNumber - 1
    });
  });

  return parts;
}

/**
 * Main parser function that detects type and parses accordingly
 */
export function parseAnalysis(rootCause: string): ParsedAnalysis {
  const type = detectAnalysisType(rootCause);
  let parts: AnalysisPart[] = [];

  switch (type) {
    case 'complete':
      parts = parseCompleteAnalysis(rootCause);
      break;
    case 'specialized':
      parts = parseSpecializedAnalysis(rootCause);
      break;
    case 'simple':
      parts = [{
        title: 'Root Cause Analysis',
        content: rootCause,
        index: 0
      }];
      break;
  }

  return {
    type,
    parts,
    rawContent: rootCause
  };
}

/**
 * Formats markdown-like content for better readability
 */
export function formatContent(content: string): string {
  // Preserve existing formatting
  return content;
}
