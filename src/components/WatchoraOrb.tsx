// Watchora Orb (React wrapper): canvas visual for the voice assistant state,
// adapted from akastrokjoseph/Jarvis (MIT) and re-themed for Watchora.
// Decorative + status-accurate; always paired with a spoken/text status, so
// it is aria-hidden and never the only channel for state.

import { useEffect, useRef } from 'react';
import { OrbRenderer, ORB_STATE_LABELS, type OrbState } from './orbRenderer';

export type { OrbState } from './orbRenderer';
import type { OrbState as OrbStateT } from './orbRenderer';

export function WatchoraOrb({
  state,
  /** Current audio level 0..1 (mic while listening). Optional — orb still
   *  animates statefully without it. */
  getLevel,
  size = 180,
  onClick,
}: {
  state: OrbStateT;
  getLevel?: () => number;
  size?: number;
  onClick?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<OrbRenderer | null>(null);
  const stateRef = useRef<OrbStateT>(state);
  stateRef.current = state;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: OrbRenderer;
    try {
      renderer = new OrbRenderer(canvas);
    } catch {
      return; // no 2d context: the text status line carries the state
    }
    rendererRef.current = renderer;
    renderer.setState(stateRef.current);
    renderer.start();

    let raf = 0;
    if (getLevel) {
      const pump = () => {
        renderer.setLevel(getLevel());
        raf = requestAnimationFrame(pump);
      };
      raf = requestAnimationFrame(pump);
    }

    return () => {
      if (raf) cancelAnimationFrame(raf);
      renderer.stop();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to state changes without restarting the renderer.
  useEffect(() => {
    rendererRef.current?.setState(state);
  }, [state]);

  return (
    <div
      className="watchora-orb"
      style={{ width: size, height: size }}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      aria-label={onClick ? `Watchora voice: ${ORB_STATE_LABELS[state]}. Activate to toggle listening.` : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <canvas ref={canvasRef} aria-hidden="true" style={{ width: '100%', height: '100%', display: 'block' }} />
      <span className="watchora-orb-label" aria-hidden="true">{ORB_STATE_LABELS[state]}</span>
    </div>
  );
}
