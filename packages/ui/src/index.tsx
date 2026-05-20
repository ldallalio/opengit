import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { clsx } from "clsx";

export function Button({
  variant = "secondary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return <button className={clsx("og-button", `og-button-${variant}`, className)} {...props} />;
}

export function IconButton({
  label,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
}) {
  return (
    <button className={clsx("og-icon-button", className)} title={label} aria-label={label} {...props}>
      {children}
    </button>
  );
}

export function Panel({
  title,
  actions,
  children,
  className,
  ...props
}: HTMLAttributes<HTMLElement> & {
  title?: string;
  actions?: ReactNode;
}) {
  return (
    <section className={clsx("og-panel", className)} {...props}>
      {(title || actions) && (
        <div className="og-panel-header">
          {title && <h2>{title}</h2>}
          {actions && <div className="og-panel-actions">{actions}</div>}
        </div>
      )}
      <div className="og-panel-body">{children}</div>
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="og-empty-state">{children}</div>;
}
