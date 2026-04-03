export function getPhaseLabel(phase: string): string {
  const labels: Record<string, string> = {
    fetching_tickets: 'Fetching Tickets',
    enriching: 'Enriching Content',
    generating: 'Generating Release Notes',
    computing_insights: 'Computing Insights',
    saving: 'Saving',
    complete: 'Complete',
    failed: 'Failed',
    error: 'Error',
  };
  return labels[phase] || phase;
}

export function getPhaseColor(phase: string): string {
  if (phase === 'complete') return 'bg-green-500';
  if (phase === 'failed' || phase === 'error') return 'bg-red-500';
  return 'bg-amber-500';
}
