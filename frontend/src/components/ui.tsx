/** Shared primitives. Styled with tokens only; no component-library theme. */
import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router';
import { cn } from '../lib/cn';
import type { Tone } from '../lib/status';

/* ------------------------------------------------------------ buttons */

type Variant = 'primary' | 'secondary' | 'ghost' | 'success' | 'danger';
type Size = 'sm' | 'md';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:brightness-105 font-semibold border border-transparent',
  secondary: 'bg-raised text-text border border-line-strong hover:border-faint',
  ghost: 'bg-transparent text-muted hover:text-text hover:bg-raised border border-transparent',
  success: 'bg-success/15 text-success-text border border-success/40 hover:bg-success/25',
  danger: 'bg-danger/10 text-danger border border-danger/40 hover:bg-danger/20',
};

const SIZE: Record<Size, string> = {
  // Both sizes keep a 44 px touch target; "sm" only tightens padding and type.
  sm: 'min-h-11 px-3 text-[13px] gap-1.5',
  md: 'min-h-11 px-4 text-sm gap-2',
};

export const buttonClass = (variant: Variant = 'secondary', size: Size = 'md', extra?: string) =>
  cn(
    'inline-flex items-center justify-center rounded-button font-medium whitespace-nowrap select-none',
    'transition-[background,border-color,filter,color] duration-[var(--cp-fast)]',
    'disabled:opacity-50 disabled:pointer-events-none',
    VARIANT[variant],
    SIZE[size],
    extra,
  );

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; icon?: ReactNode }
>(function Button({ variant = 'secondary', size = 'md', icon, className, children, type = 'button', ...rest }, ref) {
  return (
    <button ref={ref} type={type} className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
    </button>
  );
});

export function ButtonLink({
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
  ...rest
}: LinkProps & { variant?: Variant; size?: Size; icon?: ReactNode }) {
  return (
    <Link className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}

/** Icon-only button: the label is required, because there is no visible text. */
export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }
>(function IconButton({ label, className, children, type = 'button', ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-11 items-center justify-center rounded-button text-muted hover:text-text hover:bg-raised',
        'border border-transparent transition-colors duration-[var(--cp-fast)]',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

/* -------------------------------------------------------- pills & chips */

const TONE_PILL: Record<Tone, string> = {
  neutral: 'bg-raised text-muted border-line-strong',
  info: 'bg-info/12 text-info border-info/35',
  success: 'bg-success/12 text-success-text border-success/35',
  warning: 'bg-warning/12 text-warning-text border-warning/35',
  danger: 'bg-danger/12 text-danger border-danger/35',
  accent: 'bg-accent/12 text-accent border-accent/35',
};

export function Pill({ tone = 'neutral', children, className, dot = false }: { tone?: Tone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11.5px] font-medium leading-5 whitespace-nowrap',
        TONE_PILL[tone],
        className,
      )}
    >
      {dot && <span aria-hidden className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Chip({ children, tone = 'neutral', title }: { children: ReactNode; tone?: Tone; title?: string }) {
  return (
    <span
      title={title}
      className={cn('inline-flex items-center rounded-control border px-1.5 py-px font-mono text-[11px] leading-5', TONE_PILL[tone])}
    >
      {children}
    </span>
  );
}

/* ---------------------------------------------------------- segmented */

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
  hideLabel = true,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: ReactNode; count?: number }>;
  onChange: (value: T) => void;
  className?: string;
  hideLabel?: boolean;
}) {
  const id = useId();
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <span id={id} className={hideLabel ? 'sr-only' : 'text-xs font-medium text-muted'}>
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={id} className="inline-flex w-fit rounded-button border border-line bg-surface p-1">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(o.value)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                e.preventDefault();
                const i = options.findIndex((x) => x.value === value);
                const next = options[(i + (e.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length];
                onChange(next.value);
              }}
              tabIndex={active ? 0 : -1}
              className={cn(
                'min-h-9 rounded-control px-3 text-[13px] font-medium transition-colors duration-[var(--cp-fast)]',
                active ? 'bg-accent text-accent-ink' : 'text-muted hover:text-text',
              )}
            >
              {o.label}
              {o.count !== undefined && (
                <span className={cn('ml-1.5 font-mono text-[11px]', active ? 'text-accent-ink/80' : 'text-faint')}>{o.count}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- select */

export function Select({
  label,
  children,
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn('flex flex-col gap-1', className)}>
      <span className="sr-only">{label}</span>
      <select
        id={id}
        aria-label={label}
        className="min-h-11 rounded-control border border-line bg-surface px-3 pr-8 text-[13px] text-text hover:border-line-strong"
        {...rest}
      >
        {children}
      </select>
    </label>
  );
}

/* --------------------------------------------------------------- meter */

export function Meter({ label, value, max, display }: { label: string; value: number; max: number; display: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="font-mono text-[11px] text-faint">{display}</span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={display}
        className="h-1.5 overflow-hidden rounded-full bg-raised"
      >
        <div className={cn('h-full rounded-full', pct > 90 ? 'bg-warning' : 'bg-accent')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      className="h-1.5 w-full overflow-hidden rounded-full bg-raised"
    >
      <div className="h-full rounded-full bg-accent transition-[width] duration-[var(--cp-med)]" style={{ width: `${value * 100}%` }} />
    </div>
  );
}

/* -------------------------------------------------------------- states */

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton rounded-card', className)} />;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-panel border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
      <h3 className="text-base font-semibold">{title}</h3>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
      {action}
    </div>
  );
}

export function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-panel border border-danger/40 bg-danger/8 p-4 text-sm">
      <p className="text-danger">{message}</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Card({ children, className, as: As = 'section' }: { children: ReactNode; className?: string; as?: 'section' | 'div' | 'article' }) {
  return <As className={cn('rounded-panel border border-line bg-surface', className)}>{children}</As>;
}

/** Portrait thumbnail at the panel's 128:148 ratio. */
export function CoverThumb({ src, alt, className, children }: { src: string | null | undefined; alt: string; className?: string; children?: ReactNode }) {
  return (
    <div className={cn('cover-frame relative rounded-control', className)}>
      {src ? (
        <img src={src} alt={alt} loading="lazy" decoding="async" />
      ) : (
        <div aria-label={alt} role="img" className="flex h-full items-center justify-center text-xs text-faint">
          No art yet
        </div>
      )}
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-col gap-4">
      {children}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] leading-tight font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
