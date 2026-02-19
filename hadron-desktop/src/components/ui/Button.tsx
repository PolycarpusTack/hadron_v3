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
  primary: "bg-blue-600 hover:bg-blue-700 text-white",
  secondary: "bg-gray-700 hover:bg-gray-600 text-white",
  danger: "bg-red-600 hover:bg-red-700 text-white",
  success: "bg-green-600 hover:bg-green-700 text-white",
  warning: "bg-orange-600 hover:bg-orange-700 text-white",
  accent: "bg-purple-600 hover:bg-purple-700 text-white",
  ghost: "bg-transparent hover:bg-gray-700 text-gray-300",
  "ghost-danger": "bg-transparent hover:bg-gray-700 text-red-400",
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
