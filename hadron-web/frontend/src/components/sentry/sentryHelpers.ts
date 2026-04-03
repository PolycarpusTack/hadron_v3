export function getLevelColor(level: string): string {
  switch (level) {
    case 'fatal': return 'bg-purple-100 text-purple-800';
    case 'error': return 'bg-red-100 text-red-800';
    case 'warning': return 'bg-yellow-100 text-yellow-800';
    case 'info': return 'bg-blue-100 text-blue-800';
    case 'debug': return 'bg-gray-100 text-gray-600';
    default: return 'bg-gray-100 text-gray-600';
  }
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'resolved': return 'bg-green-100 text-green-800';
    case 'ignored': return 'bg-gray-100 text-gray-500';
    case 'unresolved': return 'bg-red-100 text-red-800';
    default: return 'bg-gray-100 text-gray-600';
  }
}

export function getSeverityColor(severity: string | null): string {
  switch (severity?.toUpperCase()) {
    case 'CRITICAL': return 'bg-purple-100 text-purple-800';
    case 'HIGH': return 'bg-red-100 text-red-800';
    case 'MEDIUM': return 'bg-yellow-100 text-yellow-800';
    case 'LOW': return 'bg-green-100 text-green-800';
    default: return 'bg-gray-100 text-gray-600';
  }
}

export function getEffortColor(effort: string): string {
  switch (effort) {
    case 'low': return 'bg-green-100 text-green-800';
    case 'medium': return 'bg-yellow-100 text-yellow-800';
    case 'high': return 'bg-red-100 text-red-800';
    default: return 'bg-gray-100 text-gray-600';
  }
}

export function getPriorityColor(priority: string): string {
  switch (priority) {
    case 'high': return 'text-red-600';
    case 'medium': return 'text-yellow-600';
    case 'low': return 'text-green-600';
    default: return 'text-gray-600';
  }
}

export function formatCount(count: string | number | null): string {
  if (count === null || count === undefined) return '0';
  const n = typeof count === 'string' ? parseInt(count, 10) : count;
  if (isNaN(n)) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

export function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return '\u2014';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  const diffMon = Math.floor(diffDay / 30);
  return `${diffMon}mo ago`;
}

export function getPatternIcon(patternType: string): string {
  const icons: Record<string, string> = {
    deadlock: '\u{1F512}', n_plus_one: '\u{1F504}', memory_leak: '\u{1F4A7}',
    unhandled_promise: '\u26A0\uFE0F', race_condition: '\u{1F3C1}',
    connection_exhaustion: '\u{1F50C}', timeout_cascade: '\u23F1\uFE0F',
    auth_failure: '\u{1F510}', constraint_violation: '\u{1F6AB}',
    resource_exhaustion: '\u{1F4C9}', stack_overflow: '\u{1F4DA}',
  };
  return icons[patternType] || '\u{1F50D}';
}

export function getPatternLabel(patternType: string): string {
  const labels: Record<string, string> = {
    deadlock: 'Deadlock', n_plus_one: 'N+1 Query', memory_leak: 'Memory Leak',
    unhandled_promise: 'Unhandled Promise', race_condition: 'Race Condition',
    connection_exhaustion: 'Connection Exhaustion', timeout_cascade: 'Timeout Cascade',
    auth_failure: 'Auth Failure', constraint_violation: 'Constraint Violation',
    resource_exhaustion: 'Resource Exhaustion', stack_overflow: 'Stack Overflow',
  };
  return labels[patternType] || 'Generic';
}
