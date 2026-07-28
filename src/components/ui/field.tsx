import type { InputHTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/utils";

interface FieldProps {
  label: string;
  htmlFor: string;
  helper?: string;
  error?: string;
  children: ReactNode;
}

export function Field({ label, htmlFor, helper, error, children }: FieldProps) {
  return (
    <div className="grid gap-2">
      <label
        htmlFor={htmlFor}
        className="text-xs font-semibold text-text-primary"
      >
        {label}
      </label>
      {children}
      {helper ? (
        <p className="text-xs leading-5 text-text-tertiary">{helper}</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs leading-5 text-danger-strong">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-control border border-border-strong bg-surface-inset px-3 text-sm text-text-primary outline-none placeholder:text-text-tertiary focus:border-signal focus:ring-2 focus:ring-signal/20 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
