/** Confirmation for anything destructive. Every delete in the app goes through this.
 *  `requireText` makes the user type a word (e.g. DELETE) before the button unlocks. */
import * as Dialog from '@radix-ui/react-dialog';
import { useState, type ReactElement, type ReactNode } from 'react';
import { Button } from './ui';

export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel = 'Delete',
  requireText,
  onConfirm,
  children,
}: {
  /** A Button or IconButton; it opens the dialog. */
  trigger: ReactElement;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  requireText?: string;
  onConfirm: () => void;
  /** Extra controls (e.g. a checkbox) shown above the buttons. */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const locked = Boolean(requireText) && typed.trim() !== requireText;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setTyped('');
      }}
    >
      <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-panel border border-line-strong bg-surface p-5 text-text shadow-2xl outline-none">
          <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
          <Dialog.Description asChild>
            <div className="text-sm leading-relaxed text-muted">{description}</div>
          </Dialog.Description>
          {children}
          {requireText && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted">
                Type <code className="font-mono text-text">{requireText}</code> to confirm
              </span>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="min-h-11 rounded-control border border-line bg-bg px-3 font-mono text-sm hover:border-line-strong"
              />
            </label>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="ghost">Cancel</Button>
            </Dialog.Close>
            <Button
              variant="danger"
              disabled={locked}
              onClick={() => {
                onConfirm();
                setOpen(false);
                setTyped('');
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
