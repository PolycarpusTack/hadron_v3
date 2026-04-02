const CATEGORY_COLORS: Record<string, string> = {
  security: "bg-red-500/20 text-red-400",
  performance: "bg-amber-500/20 text-amber-400",
  error: "bg-rose-500/20 text-rose-400",
  "best-practice": "bg-sky-500/20 text-sky-400",
};

export function CategoryBadge({ category }: { category: string }) {
  const color = CATEGORY_COLORS[category.toLowerCase()] || CATEGORY_COLORS["best-practice"];
  return (
    <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${color}`}>
      {category}
    </span>
  );
}
