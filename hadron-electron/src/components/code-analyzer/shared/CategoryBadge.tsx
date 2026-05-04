export default function CategoryBadge({ category }: { category: string }) {
  const colors: Record<string, string> = {
    security: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
    performance: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
    error: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
    "best-practice": "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  };

  const labels: Record<string, string> = {
    security: "Security",
    performance: "Performance",
    error: "Error",
    "best-practice": "Best Practice",
  };

  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[category] || colors["best-practice"]}`}>
      {labels[category] || category}
    </span>
  );
}
