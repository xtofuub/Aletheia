import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  detail?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  detail,
}: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state__signal" aria-hidden="true">
        <Icon size={24} strokeWidth={1.5} />
      </div>
      <div className="max-w-md">
        <h2 className="text-balance text-xl font-semibold text-text-primary">
          {title}
        </h2>
        <p className="mt-2 text-sm leading-6 text-text-secondary">
          {description}
        </p>
        {detail ? (
          <p className="mt-3 font-mono text-[11px] leading-5 text-text-tertiary">
            {detail}
          </p>
        ) : null}
        {action ? <div className="mt-5">{action}</div> : null}
      </div>
    </div>
  );
}
