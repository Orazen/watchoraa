// FocusManager: after route/modal changes, move focus to the new page heading
// and return focus to the triggering control after a modal closes. Prevents
// focus traps except inside genuine modal confirmations.

import { useEffect, useRef } from 'react';

export type FocusManagerHandle = {
  /** Move focus to an element by id (e.g. a page heading). */
  focusId: (id: string) => void;
  /** Remember the currently-focused element so it can be restored later. */
  save: () => HTMLElement | null;
  /** Restore focus to a previously saved element (or null to skip). */
  restore: (el: HTMLElement | null) => void;
};

/** Focuses an element safely (falls back to the element itself). */
export function focusElement(el: HTMLElement | null | undefined): void {
  if (!el) return;
  try {
    el.focus({ preventScroll: false });
  } catch {
    (el as HTMLElement & { focus?: () => void }).focus?.();
  }
}

/** Hook: focuses the given heading id when `active` becomes true. */
export function useFocusOnShow(id: string | undefined, active: boolean): void {
  useEffect(() => {
    if (!active || !id) return;
    const t = setTimeout(() => {
      const el = document.getElementById(id);
      if (el) focusElement(el);
    }, 50);
    return () => clearTimeout(t);
  }, [active, id]);
}

/** Modal focus trap: keeps Tab within the dialog, returns focus on close. */
export function useFocusTrap(containerRef: React.RefObject<HTMLElement | null>, active: boolean): void {
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;
    restoreRef.current = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusables = container.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])');
      if (focusables.length === 0) return;
      const first = focusables[0]!;
      const last = focusables[focusables.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    container.addEventListener('keydown', onKey);
    return () => {
      container.removeEventListener('keydown', onKey);
      // Restore focus to the triggering control.
      if (restoreRef.current) focusElement(restoreRef.current);
    };
  }, [active, containerRef]);
}
