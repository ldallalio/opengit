import { useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
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
  collapsible = true,
  defaultCollapsed = false,
  ...props
}: HTMLAttributes<HTMLElement> & {
  title?: string;
  actions?: ReactNode;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <section className={clsx("og-panel", collapsed && "og-panel-collapsed", className)} {...props}>
      {(title || actions) && (
        <div className="og-panel-header">
          <div className="og-panel-title">
            {collapsible && (
              <button
                className="og-panel-toggle"
                type="button"
                aria-label={collapsed ? `Expand ${title ?? "section"}` : `Collapse ${title ?? "section"}`}
                onClick={() => setCollapsed((value) => !value)}
              >
                {collapsed ? "+" : "-"}
              </button>
            )}
            {title && <h2>{title}</h2>}
          </div>
          {actions && <div className="og-panel-actions">{actions}</div>}
        </div>
      )}
      {!collapsed && <div className="og-panel-body">{children}</div>}
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="og-empty-state">{children}</div>;
}
