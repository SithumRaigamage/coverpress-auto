import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { STATUS_LABEL } from '../lib/format';
import type { CoverStatus, Usage } from '../api/types';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  icon?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={cn('btn', `btn--${variant}`, `btn--${size}`, className)} {...rest}>
      {icon}
      {children}
    </button>
  );
});

type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger';

export function Chip({ children, tone = 'neutral', className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <span className={cn('chip', `chip--${tone}`, className)}>{children}</span>;
}

const STATUS_TONE: Record<CoverStatus, Tone> = {
  queued: 'neutral',
  processing: 'accent',
  auto_approved: 'ok',
  needs_review: 'warn',
  failed: 'danger',
  approved: 'ok',
  rejected: 'neutral',
};

export function StatusChip({ status }: { status: CoverStatus }) {
  return <Chip tone={STATUS_TONE[status] ?? 'neutral'}>{STATUS_LABEL[status] ?? status}</Chip>;
}

export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const percent = max > 0 ? Math.min(100, Math.max(0, Math.round((value / max) * 100))) : 0;
  return (
    <div className="meter">
      <div className="meter__head mono">
        <span>{label}</span>
        <span>{value} / {max}</span>
      </div>
      <div
        className="meter__track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
      >
        <div className="meter__fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export function UsageMeter({ usage }: { usage: Usage | undefined }) {
  if (!usage) return <div className="skeleton skeleton--line" aria-hidden="true" />;
  return <Meter value={usage.used} max={usage.limit} label="Covers this month" />;
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn('panel', className)}>{children}</section>;
}

export function EmptyState({
  title,
  body,
  action,
  icon,
}: {
  title: string;
  body: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state__icon">{icon}</div>}
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}

export function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-panel" role="alert">
      <div>
        <strong>Couldn't load this view</strong>
        <p>{message}</p>
      </div>
      {onRetry && <Button size="sm" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-hidden="true" />;
}

export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="skeleton-grid" aria-label="Loading" aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="skeleton-card" key={index}>
          <Skeleton className="skeleton-art" />
          <Skeleton className="skeleton--line" />
          <Skeleton className="skeleton--line skeleton--line--short" />
        </div>
      ))}
    </div>
  );
}

export function Field({
  label,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('field', className)}>
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
      {error && <span className="field__error" role="alert">{error}</span>}
    </label>
  );
}
