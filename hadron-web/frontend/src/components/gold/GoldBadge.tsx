interface GoldBadgeProps {
  status: string;
}

export function GoldBadge({ status }: GoldBadgeProps) {
  const color =
    status === "verified"
      ? "text-yellow-400"
      : status === "pending"
        ? "text-yellow-600"
        : "text-slate-500";

  return (
    <span className={`${color} text-sm`} title={`Gold: ${status}`}>
      &#9733;
    </span>
  );
}
