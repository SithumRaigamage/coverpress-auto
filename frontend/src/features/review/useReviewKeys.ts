import { useEffect } from 'react';

export interface KeyActions {
  move: (delta: number) => void;
  select: () => void;
  approve: () => void;
  reject: () => void;
  render: () => void;
  undo: () => void;
  help: () => void;
  escape: () => void;
}

/** Review is usable without a mouse. Inputs keep their normal keys. */
export function useReviewKeys(actions: KeyActions) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"]')) return;

      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (mod && key === 'z') {
        event.preventDefault();
        actions.undo();
      } else if (mod && event.key === 'Enter') {
        event.preventDefault();
        actions.render();
      } else if (mod || event.altKey) {
        return;
      } else {
        switch (key) {
          case 'j': event.preventDefault(); actions.move(1); break;
          case 'k': event.preventDefault(); actions.move(-1); break;
          case 'enter': event.preventDefault(); actions.select(); break;
          case 'a': event.preventDefault(); actions.approve(); break;
          case 'r': event.preventDefault(); actions.reject(); break;
          case '?': event.preventDefault(); actions.help(); break;
          case 'escape': actions.escape(); break;
          default: break;
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [actions]);
}
