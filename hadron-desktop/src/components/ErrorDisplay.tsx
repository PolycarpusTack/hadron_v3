interface ErrorState {
  message: string;
  suggestions: string[];
}

interface ErrorDisplayProps {
  error: ErrorState | null;
}

export default function ErrorDisplay({ error }: ErrorDisplayProps) {
  if (!error) return null;

  return (
    <div className="mb-6 bg-red-500/10 border border-red-500/20 rounded-lg p-4">
      <p className="text-red-400 font-semibold mb-2">Error: {error.message}</p>
      {error.suggestions.length > 0 && (
        <div className="mt-3 text-sm text-red-300">
          <p className="font-semibold mb-1">Try these solutions:</p>
          <ul className="list-disc list-inside space-y-1">
            {error.suggestions.map((suggestion, index) => (
              <li key={index}>{suggestion}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
