import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/cn';

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content className={cn('dialog-content', wide && 'dialog-content--wide')}>
          <DialogPrimitive.Title className="dialog-title">{title}</DialogPrimitive.Title>
          {description && <DialogPrimitive.Description className="dialog-description">{description}</DialogPrimitive.Description>}
          <DialogPrimitive.Close className="dialog-close" aria-label="Close dialog">
            <X size={16} />
          </DialogPrimitive.Close>
          {children}
          {footer && <div className="dialog-footer">{footer}</div>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
