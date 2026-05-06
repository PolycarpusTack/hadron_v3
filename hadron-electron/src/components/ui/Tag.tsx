interface TagProps {
  text: string;
  color?: string;
}

export default function Tag({ text, color = "#6b7280" }: TagProps) {
  return (
    <span style={{
      fontSize: "9px",
      fontWeight: 700,
      letterSpacing: ".06em",
      fontFamily: "var(--hd-font-mono,'JetBrains Mono',monospace)",
      color,
      background: `${color}18`,
      padding: "2px 6px",
      borderRadius: "3px",
      display: "inline-block",
    }}>
      {text}
    </span>
  );
}
