interface ApiKeyWarningProps {
  hasApiKey: boolean;
}

export default function ApiKeyWarning({ hasApiKey }: ApiKeyWarningProps) {
  if (hasApiKey) return null;

  return (
    <div className="mb-6 bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
      <p className="text-yellow-400">
        Warning: API Key Required - Please set your OpenAI API key in Settings to analyze crash logs
      </p>
    </div>
  );
}
