import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function Button({
  children,
  variant = "primary",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" }) {
  const base =
    "inline-flex items-center justify-center rounded-md px-4 py-2.5 text-sm font-semibold " +
    "transition-colors disabled:cursor-not-allowed disabled:opacity-60 " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
  const look =
    variant === "primary"
      ? "bg-brand text-white hover:bg-brand-dark"
      : "text-ink-soft hover:bg-rule/50";
  return (
    <button type="button" className={`${base} ${look} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold">{label}</span>
      <input
        className="rounded-md border border-rule bg-surface px-3 py-2.5 text-base
                   outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        {...rest}
      />
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

/** `id` so a card can be linked to and scrolled to; nothing else needs it. */
export function Card({
  children,
  className = "",
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div id={id} className={`rounded-lg border border-rule bg-surface p-6 ${className}`}>
      {children}
    </div>
  );
}

/** Errors say what went wrong, in the user's language, with no apology. */
export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
      {children}
    </p>
  );
}
