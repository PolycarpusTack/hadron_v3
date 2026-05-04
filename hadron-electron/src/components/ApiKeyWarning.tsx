interface ApiKeyWarningProps {
  hasApiKey: boolean;
}

export default function ApiKeyWarning({ hasApiKey }: ApiKeyWarningProps) {
  if (hasApiKey) return null;

  return (
    <div className="mb-6 rounded-lg p-4" style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)' }}>
      <p className="text-yellow-400">
        Warning: API Key Required - Please set your API key in the Configure tab to analyze crash logs
      </p>
    </div>
  );
}
