import type { KeyboardEvent } from 'react';

/**
 * Keyboard behaviour for a role="tablist" (WAI-ARIA Authoring Practices,
 * tabs pattern with automatic activation).
 *
 * Roving tabindex (WCAG SC 2.1.1): exactly one tab — the selected one —
 * stays in the Tab sequence (tabIndex={0}); the rest get tabIndex={-1}.
 * Arrow keys then move focus AND selection with wrap-around, Home/End jump
 * to the first/last tab. Without this a keyboard user had to tab through
 * every tab to reach the page content, and the arrows did nothing — a
 * screen-reader user heard "tab, 1 of 7" with no way to move between tabs
 * other than Tab/Shift-Tab.
 *
 * The container's [role="tab"] descendants are looked up at keypress time,
 * so the caller does not need to keep a refs array in sync with render.
 */
export function handleTablistKeys(
  event: KeyboardEvent<HTMLDivElement>,
  /** Receives the index of the tab to activate (the one now focused). */
  onActivate: (index: number) => void,
): void {
  const tabs = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  );
  const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
  if (current === -1) return;
  let next: number;
  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      next = (current + 1) % tabs.length;
      break;
    case 'ArrowLeft':
    case 'ArrowUp':
      next = (current - 1 + tabs.length) % tabs.length;
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = tabs.length - 1;
      break;
    default:
      return;
  }
  event.preventDefault();
  tabs[next].focus();
  // Selection follows focus (automatic activation), so moving to a tab by
  // keyboard switches the panel exactly like clicking it.
  onActivate(next);
}
