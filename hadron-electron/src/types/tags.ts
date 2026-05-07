export interface Tag {
  id: number;
  name: string;
  color: string;
  usageCount: number;
  createdAt: string;
}

export interface AnalysisNote {
  id: number;
  analysisId: number;
  content: string;
  createdAt: string;
  updatedAt?: string;
}

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

export interface ErrorPatternCount {
  signature: string;
  errorType: string;
  component: string | null;
  count: number;
}

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

export function getTagColorClasses(hexColor: string): { bg: string; text: string; border: string } {
  const entry = Object.values(TAG_COLORS).find(c => c.hex.toLowerCase() === hexColor.toLowerCase());
  if (entry) {
    return { bg: entry.bg, text: entry.text, border: entry.border };
  }
  return TAG_COLORS.gray;
}
