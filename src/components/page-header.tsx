import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description: string;
  action?: ReactNode;
  meta?: string;
}

export function PageHeader({
  title,
  description,
  action,
  meta,
}: PageHeaderProps) {
  return (
    <header className="page-header">
      <div>
        {meta ? (
          <p className="font-mono text-[10px] text-text-tertiary">{meta}</p>
        ) : null}
        <h1 className="mt-1 text-2xl font-semibold tracking-[-0.02em] text-text-primary">
          {title}
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-text-secondary">
          {description}
        </p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
