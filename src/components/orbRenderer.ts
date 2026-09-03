// Watchora Orb — adapted from akastrokjoseph/Jarvis's orbRenderer (MIT),
// re-themed for Watchora's lavender design language and wired to the real
// voice assistant state. No framer-motion; honors prefers-reduced-motion.
//
// The orb is decorative but state-accurate: it reflects what Watchora is
// actually doing (listening / processing / speaking / hazard / offline).
// It is always paired with a spoken or text status line — a blind user never
// needs it, a low-vision user can glance at it.

export type OrbState = 'idle' | 'listening' | 'processing' | 'speaking' | 'hazard' | 'error';

export const ORB_STATE_HUES: Record<OrbState, number> = {
  idle: 262, // lavender — standing by
  listening: 190, // cyan — mic open
  processing: 285, // violet — routing the command
  speaking: 165, // teal — Watchora is talking
  hazard: 355, // red — hazard / emergency speech active
  error: 355,
};

export const ORB_STATE_LABELS: Record<OrbState, string> = {
  idle: 'Standing by',
  listening: 'Listening',
  processing: 'Thinking',
  speaking: 'Speaking',
  hazard: 'Hazard alert',
  error: 'Voice error',
};

interface Particle {
  angle: number;
  radius: number;
  speed: number;
  size: number;
  wobblePhase: number;
  wobbleSpeed: number;
  alpha: number;
}

interface StateParams {
  intensity: number;
  speed: number;
  coreScale: number;
  ringAlpha: number;
  waveAlpha: number;
}

const STATE_PARAMS: Record<OrbState, StateParams> = {
  idle: { intensity: 0.45, speed: 0.35, coreScale: 1, ringAlpha: 0.5, waveAlpha: 0 },
  listening: { intensity: 0.85, speed: 0.6, coreScale: 1.04, ringAlpha: 0.75, waveAlpha: 0.9 },
  processing: { intensity: 0.75, speed: 2.2, coreScale: 0.94, ringAlpha: 1, waveAlpha: 0 },
  speaking: { intensity: 1, speed: 0.8, coreScale: 1.06, ringAlpha: 0.6, waveAlpha: 1 },
  hazard: { intensity: 0.95, speed: 1.6, coreScale: 1.1, ringAlpha: 1, waveAlpha: 0.4 },
  error: { intensity: 0.9, speed: 0.25, coreScale: 0.92, ringAlpha: 0.4, waveAlpha: 0 },
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Shortest-path hue interpolation so cyan→red doesn't sweep the rainbow. */
function lerpHue(a: number, b: number, t: number) {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}

export class OrbRenderer {
  private ctx: CanvasRenderingContext2D;
  private raf = 0;
  private running = false;
  private t = 0;
  private lastTime = 0;
  private state: OrbState = 'idle';
  private level = 0;
  private smoothLevel = 0;
  private current: { hue: number } & StateParams;
  private particles: Particle[] = [];
  private ringTilts = [0.42, 0.75, 0.28];
  private ringPhases = [0, 2.1, 4.2];
  private wavePhases: number[];
  /** Reduced motion: static glow + core, no particles/rings animation loop churn. */
  private reducedMotion: boolean;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
    this.current = { hue: ORB_STATE_HUES.idle, ...STATE_PARAMS.idle };
    this.wavePhases = Array.from({ length: 96 }, () => Math.random() * Math.PI * 2);
    for (let i = 0; i < 90; i++) {
      this.particles.push({
        angle: Math.random() * Math.PI * 2,
        radius: 0.55 + Math.random() * 0.85,
        speed: (0.08 + Math.random() * 0.25) * (Math.random() > 0.5 ? 1 : -1),
        size: 0.6 + Math.random() * 1.6,
        wobblePhase: Math.random() * Math.PI * 2,
        wobbleSpeed: 0.3 + Math.random() * 0.8,
        alpha: 0.25 + Math.random() * 0.6,
      });
    }
    this.reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  setState(state: OrbState) {
    this.state = state;
  }

  /** Audio level 0..1 (mic while listening, TTS while speaking). */
  setLevel(level: number) {
    this.level = Math.max(0, Math.min(1, level));
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.lastTime) / 1000);
      this.lastTime = now;
      this.t += dt;
      this.frame(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private frame(dt: number) {
    const { canvas, ctx } = this;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = canvas.clientWidth || canvas.width;
    const cssH = canvas.clientHeight || canvas.height;
    if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const target = { hue: ORB_STATE_HUES[this.state], ...STATE_PARAMS[this.state] };
    const ease = 1 - Math.pow(0.02, dt);
    this.current.hue = lerpHue(this.current.hue, target.hue, ease);
    this.current.intensity = lerp(this.current.intensity, target.intensity, ease);
    this.current.speed = lerp(this.current.speed, target.speed, ease);
    this.current.coreScale = lerp(this.current.coreScale, target.coreScale, ease);
    this.current.ringAlpha = lerp(this.current.ringAlpha, target.ringAlpha, ease);
    this.current.waveAlpha = lerp(this.current.waveAlpha, target.waveAlpha, ease);

    const attack = 1 - Math.pow(0.0001, dt);
    const release = 1 - Math.pow(0.15, dt);
    this.smoothLevel =
      this.level > this.smoothLevel ? lerp(this.smoothLevel, this.level, attack) : lerp(this.smoothLevel, this.level, release);

    const cx = cssW / 2;
    const cy = cssH / 2;
    const R = Math.min(cssW, cssH) * 0.26;
    const { hue, intensity } = this.current;
    const lvl = this.smoothLevel;
    const motion = this.reducedMotion ? 0 : 1;

    const breath = 1 + Math.sin(this.t * 1.4) * 0.012 * (motion || 1);
    const coreR = R * this.current.coreScale * breath * (1 + lvl * 0.12);

    // Outer ambient glow
    {
      const g = ctx.createRadialGradient(cx, cy, coreR * 0.4, cx, cy, R * 3.1);
      g.addColorStop(0, `hsla(${hue} 95% 60% / ${0.16 * intensity + lvl * 0.1})`);
      g.addColorStop(0.5, `hsla(${hue} 90% 55% / ${0.05 * intensity})`);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cssW, cssH);
    }

    // Particles (skipped under reduced motion)
    if (motion) {
      ctx.save();
      for (const p of this.particles) {
        p.angle += p.speed * this.current.speed * dt * 2;
        const wobble = Math.sin(this.t * p.wobbleSpeed + p.wobblePhase) * 0.06;
        const inward = this.state === 'processing' ? 0.82 : 1;
        const r = (p.radius * inward + wobble) * R * 2.1;
        const x = cx + Math.cos(p.angle) * r;
        const y = cy + Math.sin(p.angle) * r * 0.92;
        ctx.beginPath();
        ctx.arc(x, y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${hue} 90% 72% / ${p.alpha * intensity * 0.7})`;
        ctx.fill();
      }
      ctx.restore();
    }

    // Orbital rings (static tilt under reduced motion)
    ctx.save();
    ctx.translate(cx, cy);
    for (let i = 0; i < 3; i++) {
      const phase = this.ringPhases[i] + (motion ? this.t * this.current.speed * (0.5 + i * 0.24) : this.ringPhases[i] * 0.1);
      const tilt = this.ringTilts[i];
      const rr = R * (1.45 + i * 0.34) * (1 + lvl * 0.05);
      ctx.save();
      ctx.rotate(phase * 0.35);
      ctx.scale(1, tilt);
      const segs = 2 + i;
      for (let s = 0; s < segs; s++) {
        const start = phase + (s * Math.PI * 2) / segs;
        const arc = Math.PI * (0.55 - i * 0.1);
        ctx.beginPath();
        ctx.arc(0, 0, rr, start, start + arc);
        ctx.strokeStyle = `hsla(${hue} 92% 66% / ${0.34 * this.current.ringAlpha * intensity})`;
        ctx.lineWidth = i === 0 ? 1.6 : 1;
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();

    // Waveform ring (listening / speaking / hazard)
    if (this.current.waveAlpha > 0.02) {
      const bars = 72;
      const baseR = R * 1.22;
      ctx.save();
      ctx.translate(cx, cy);
      for (let i = 0; i < bars; i++) {
        const ang = (i / bars) * Math.PI * 2;
        const n =
          Math.sin(this.t * 5 * motion + this.wavePhases[i]) * 0.4 +
          Math.sin(this.t * 11 * motion + this.wavePhases[(i * 7) % 96]) * 0.25;
        const amp = Math.max(0, Math.max(lvl, motion ? 0 : 0.15) * 1.15 + n * lvl + 0.02);
        const len = amp * R * 0.55;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * baseR, Math.sin(ang) * baseR);
        ctx.lineTo(Math.cos(ang) * (baseR + len), Math.sin(ang) * (baseR + len));
        ctx.strokeStyle = `hsla(${hue} 95% 70% / ${this.current.waveAlpha * (0.28 + amp * 0.6)})`;
        ctx.lineWidth = 1.6;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
      ctx.restore();
    }

    // Core sphere
    {
      const g = ctx.createRadialGradient(cx - coreR * 0.3, cy - coreR * 0.35, coreR * 0.1, cx, cy, coreR);
      g.addColorStop(0, `hsla(${hue} 100% 88% / ${0.95 * intensity + 0.05})`);
      g.addColorStop(0.35, `hsla(${hue} 95% 62% / ${0.55 * intensity + 0.1})`);
      g.addColorStop(0.8, `hsla(${hue} 90% 42% / ${0.28 * intensity})`);
      g.addColorStop(1, `hsla(${hue} 90% 35% / 0.05)`);
      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
      ctx.strokeStyle = `hsla(${hue} 100% 78% / ${0.5 * intensity})`;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  }
}
