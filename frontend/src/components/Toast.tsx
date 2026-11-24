/** Bottom-centre toasts, max 3, 4 s; errors stay until dismissed. One polite live region. */
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Link } from 'react-router';
import { cn } from '../lib/cn';

type Kind = 'info' | 'success' | 'error';
interface Toast {
  id: number;
  kind: Kind;
  message: string;
  link?: { to: string; label: string };
}

const ToastContext = createContext<(message: string, kind?: Kind, link?: Toast['link']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);

  const push = useCallback(
    (message: string, kind: Kind = 'info', link?: Toast['link']) => {
      const id = next.current++;
      setToasts((all) => [...all.slice(-2), { id, kind, message, link }]);
      if (kind !== 'error') window.setTimeout(() => dismiss(id), 4000);
    },
    [dismiss],
  );

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="no-print pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={cn(
              'pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-card border bg-raised px-4 py-2 text-sm shadow-lg',
              t.kind === 'error' ? 'border-danger/50 text-danger' : t.kind === 'success' ? 'border-success/40' : 'border-line-strong',
            )}
          >
            <span className="flex-1">{t.message}</span>
            {t.link && (
              <Link to={t.link.to} className="font-medium text-accent underline-offset-2 hover:underline" onClick={() => dismiss(t.id)}>
                {t.link.label}
              </Link>
            )}
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => dismiss(t.id)}
              className="-mr-2 inline-flex size-11 items-center justify-center rounded-control text-faint hover:text-text"
            >
              <X size={16} aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
