import { forwardRef } from "react";
import { Loader2 } from "lucide-react";

type ButtonVariant =
  | "primary"
  | "secondary"
  | "danger"
  | "success"
  | "warning"
  | "accent"
  | "ghost"
  | "ghost-danger";

type ButtonSize = "xs" | "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  fullWidth?: boolean;
  icon?: React.ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-gradient-to-br from-emerald-500 to-emerald-600 hover:shadow-lg hover:shadow-emerald-500/30 hover:-translate-y-px text-emerald-950 font-semibold",
  secondary:
    "bg-white/[0.03] border border-[color:var(--hd-border)] text-[color:var(--hd-text)] hover:bg-[color:var(--hd-bg-hover)]",
  danger:
    "bg-red-500/[.12] border border-red-500/30 text-red-300 hover:bg-red-500/20",
  success:
    "bg-emerald-500/[.12] border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/20",
  warning:
    "bg-amber-500/[.12] border border-amber-500/30 text-amber-300 hover:bg-amber-500/20",
  accent:
    "bg-emerald-500/[.12] border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20",
  ghost:
    "bg-white/[0.03] border border-[color:var(--hd-border)] text-[color:var(--hd-text)] hover:bg-[color:var(--hd-bg-hover)]",
  "ghost-danger":
    "bg-transparent border border-[color:var(--hd-border)] text-red-400 hover:bg-red-500/10",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs: "px-2 py-1 text-xs",
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-4 py-2.5 text-sm font-medium",
};

const ICON_SIZE: Record<ButtonSize, string> = {
  xs: "w-3 h-3",
  sm: "w-3.5 h-3.5",
  md: "w-4 h-4",
  lg: "w-4 h-4",
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      loading = false,
      fullWidth = false,
      icon,
      children,
      className = "",
      disabled,
      ...props
    },
    ref
  ) => {
    const base =
      "rounded-lg transition inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed";
    const variantCls = VARIANT_CLASSES[variant];
    const sizeCls = SIZE_CLASSES[size];
    const widthCls = fullWidth ? "w-full justify-center" : "";
    const iconSize = ICON_SIZE[size];

    return (
      <button
        ref={ref}
        className={`${base} ${variantCls} ${sizeCls} ${widthCls} ${className}`}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <Loader2 className={`${iconSize} animate-spin`} />
        ) : icon ? (
          <span className={iconSize + " flex-shrink-0 [&>svg]:w-full [&>svg]:h-full"}>
            {icon}
          </span>
        ) : null}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";

export default Button;
