import * as ToastPrimitive from '@radix-ui/react-toast';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Check, Info, TriangleAlert, X } from 'lucide-react';

type Tone = 'success' | 'error' | 'info';
interface ToastEntry {
  id: number;
  title: string;
  description?: string;
  tone: Tone;
}

interface ToastApi {
  toast: (title: string, options?: { description?: string; tone?: Tone }) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastEntry[]>([]);
  const [nextId, setNextId] = useState(1);

  const toast = useCallback((title: string, options?: { description?: string; tone?: Tone }) => {
    const id = nextId;
    setNextId(id + 1);
    setItems((previous) => [...previous.slice(-2), { id, title, description: options?.description, tone: options?.tone ?? 'info' }]);
  }, [nextId]);

  return (
    <ToastContext.Provider value={{ toast }}>
      <ToastPrimitive.Provider swipeDirection="right" duration={4500}>
        {children}
        {items.map((item) => (
          <ToastPrimitive.Root
            key={item.id}
            className={`toast toast--${item.tone}`}
            onOpenChange={(open) => {
              if (!open) setItems((previous) => previous.filter((entry) => entry.id !== item.id));
            }}
          >
            <div className="toast__icon">
              {item.tone === 'success' ? <Check size={16} /> : item.tone === 'error' ? <TriangleAlert size={16} /> : <Info size={16} />}
            </div>
            <div className="toast__text">
              <ToastPrimitive.Title>{item.title}</ToastPrimitive.Title>
              {item.description && <ToastPrimitive.Description>{item.description}</ToastPrimitive.Description>}
            </div>
            <ToastPrimitive.Close className="toast__close" aria-label="Dismiss notification">
              <X size={14} />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="toast-viewport" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider');
  return value;
}
