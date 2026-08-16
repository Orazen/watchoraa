// Spatial audio helpers (v0.5). OS speechSynthesis output cannot be routed
// through Web Audio, so directional feedback is delivered as a short, soft
// stereo-panned cue tone played just before/alongside the spoken callout.
// The cue's pan position maps to the hazard zone (left/center/right), and the
// clock-position phrase in the narration reinforces the same direction.

export type PanValue = number; // -1 (hard left) .. 1 (hard right)

const CUE_FREQUENCY_HZ = 880;
const CUE_DURATION_MS = 140;
const CUE_GAIN = 0.08;

let audioContext: AudioContext | null = null;

export function getSpatialAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioContext) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      audioContext = new Ctor();
    } catch {
      return null;
    }
  }
  if (audioContext.state === 'suspended') void audioContext.resume();
  return audioContext;
}

/** Parse a pan value out of a direction word/phrase ("left", "right", "at your 2 o'clock"). */
export function panFromText(text: string): PanValue {
  const t = text.toLowerCase();
  const clock = /(\d{1,2})\s*o'?clock/.exec(t);
  if (clock) {
    const h = Number(clock[1]) % 12;
    // 12 o'clock is straight ahead (center), 3 is hard right, 9 hard left.
    // pan = sin of the angle clockwise from 12 o'clock.
    return Math.max(-1, Math.min(1, Math.sin(((h - 12) * Math.PI) / 6)));
  }
  if (t.includes('left')) return -0.8;
  if (t.includes('right')) return 0.8;
  return 0;
}

/** Play a short, quiet panned cue tone. Returns false when Web Audio is unavailable. */
export function playDirectionalCue(pan: PanValue): boolean {
  const ctx = getSpatialAudioContext();
  if (!ctx) return false;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    gain.gain.setValueAtTime(CUE_GAIN, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + CUE_DURATION_MS / 1000);
    osc.frequency.value = CUE_FREQUENCY_HZ;
    osc.type = 'sine';
    osc.connect(gain);
    gain.connect(panner);
    panner.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + CUE_DURATION_MS / 1000);
    return true;
  } catch {
    return false;
  }
}
