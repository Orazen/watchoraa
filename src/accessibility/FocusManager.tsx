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

/**
 * Selector for elements a keyboard user can actually land on. Disabled and
 * `tabindex="-1"` controls are excluded: calling .focus() on a disabled
 * element is a no-op, which would silently break the Tab cycle.
 */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Ordered list of focusable, screen-reader-visible elements inside a dialog. */
function getFocusables(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.getAttribute('aria-hidden') !== 'true',
  );
}

/**
 * Modal focus trap: moves focus INTO the dialog on open, keeps Tab within it,
 * and returns focus to the triggering control on close.
 *
 * Moving focus in is not optional for a `aria-modal="true"` dialog: assistive
 * tech hides everything outside the dialog, so focus left on the page behind
 * it is a control the screen reader has just declared hidden. The container
 * itself must therefore accept `tabIndex={-1}` so it can receive focus when it
 * has no focusable children.
 */
export function useFocusTrap(containerRef: React.RefObject<HTMLElement | null>, active: boolean): void {
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;
    restoreRef.current = document.activeElement as HTMLElement | null;

    // Wait a frame so the dialog is laid out (and any children rendered) before
    // we try to focus into it.
    const frame = requestAnimationFrame(() => {
      if (!container.isConnected) return;
      focusElement(getFocusables(container)[0] ?? container);
    });

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusables = getFocusables(container);
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
      cancelAnimationFrame(frame);
      container.removeEventListener('keydown', onKey);
      // Restore focus to the triggering control.
      if (restoreRef.current) focusElement(restoreRef.current);
    };
  }, [active, containerRef]);
}
