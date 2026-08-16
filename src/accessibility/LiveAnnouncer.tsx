// LiveAnnouncer: a single ARIA live region for status announcements.
// Routines use polite, emergencies use assertive. Prevents repeated camera
// detection labels from being read by the screen reader.

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';

interface LiveAnnouncerApi {
  announce: (message: string, mode?: 'polite' | 'assertive', dedupeKey?: string) => void;
}

const Ctx = createContext<LiveAnnouncerApi | null>(null);

export function useLiveAnnouncer(): LiveAnnouncerApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLiveAnnouncer must be used inside LiveAnnouncer');
  return v;
}

export function LiveAnnouncer({ children }: { children: ReactNode }) {
  const politeRef = useRef<HTMLDivElement | null>(null);
  const assertiveRef = useRef<HTMLDivElement | null>(null);
  const lastRef = useRef<{ key: string; at: number }>({ key: '', at: 0 });

  const announce = useCallback((message: string, mode: 'polite' | 'assertive' = 'polite', dedupeKey?: string) => {
    if (dedupeKey) {
      const now = Date.now();
      if (lastRef.current.key === dedupeKey && now - lastRef.current.at < 10_000) return;
      lastRef.current = { key: dedupeKey, at: now };
    }
    const el = mode === 'assertive' ? assertiveRef.current : politeRef.current;
    if (!el) return;
    // Clear then set so repeated identical messages are re-announced.
    el.textContent = '';
    requestAnimationFrame(() => {
      el.textContent = message;
    });
  }, []);

  return (
    <Ctx.Provider value={{ announce }}>
      {children}
      {/* Visually hidden but always in the DOM for screen readers. */}
      <div aria-live="polite" role="status" className="sr-only" ref={politeRef} />
      <div aria-live="assertive" role="alert" className="sr-only" ref={assertiveRef} />
    </Ctx.Provider>
  );
}
