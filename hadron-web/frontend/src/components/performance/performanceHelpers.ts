export function getSeverityColor(severity: string): string {
  switch (severity) {
    case 'critical': return 'bg-red-600 text-white';
    case 'high': return 'bg-red-100 text-red-800';
    case 'medium': return 'bg-yellow-100 text-yellow-800';
    case 'low': return 'bg-green-100 text-green-800';
    case 'info': return 'bg-blue-100 text-blue-800';
    case 'warning': return 'bg-amber-100 text-amber-800';
    default: return 'bg-gray-100 text-gray-600';
  }
}

export function getMethodBarColor(pct: number): string {
  if (pct >= 20) return 'bg-red-500';
  if (pct >= 10) return 'bg-orange-500';
  if (pct >= 5) return 'bg-yellow-500';
  return 'bg-blue-500';
}

export function getCategoryColor(cat: string): string {
  const m: Record<string, string> = {
    'FFI/External': 'bg-purple-100 text-purple-800',
    'Graphics': 'bg-pink-100 text-pink-800',
    'GC': 'bg-red-100 text-red-800',
    'Database': 'bg-blue-100 text-blue-800',
    'UI Rendering': 'bg-orange-100 text-orange-800',
    'Collection': 'bg-green-100 text-green-800',
    'Session': 'bg-cyan-100 text-cyan-800',
  };
  return m[cat] || 'bg-gray-100 text-gray-600';
}

export function getRecTypeIcon(t: string): string {
  const m: Record<string, string> = {
    optimization: '\u2699\uFE0F',
    workaround: '\u{1F527}',
    investigation: '\u{1F50D}',
    configuration: '\u2699\uFE0F',
    documentation: '\u{1F4DD}',
  };
  return m[t] || '\u{1F4CB}';
}

export function formatSeconds(s: number): string {
  if (s < 1) return `${(s * 1000).toFixed(0)}ms`;
  if (s < 60) return `${s.toFixed(2)}s`;
  return `${(s / 60).toFixed(1)}min`;
}
