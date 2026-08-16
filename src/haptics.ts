// OKO-style haptic + audio vocabulary for the local hazard layer.
// Design principles applied (see docs/yolo-ocr-slam-plan.md #2.4):
//   - Intensity = confidence, tempo = urgency, silence = uncertainty.
//   - Binary before nuance: "is there a hazard" comes first, detail is layered on.
//   - Redundant channels: every pattern pairs a vibration pattern with a distinct tone.
//   - No required learning: rising tone = clear/positive, low tone = caution,
//     fast pulses = urgent — matches OKO's cross-culturally intuitive mappings.

export type HapticEvent = 'hazard-immediate' | 'hazard-nearby' | 'clear' | 'landmark' | 'lost-signal';

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioContext) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioContext = new Ctor();
  }
  return audioContext;
}

function playTone(frequencies: number[], durationMs: number, type: OscillatorType = 'sine', gain = 0.08) {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();

  const now = ctx.currentTime;
  const stepDuration = durationMs / 1000 / frequencies.length;

  frequencies.forEach((freq, index) => {
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gainNode.gain.value = gain;
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    const start = now + index * stepDuration;
    const end = start + stepDuration;
    gainNode.gain.setValueAtTime(gain, start);
    gainNode.gain.exponentialRampToValueAtTime(0.001, end);
    osc.start(start);
    osc.stop(end);
  });
}

function vibrate(pattern: number | number[]) {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(pattern);
  }
}

export type HapticSettings = {
  hapticsEnabled: boolean;
  toneEnabled: boolean;
  intensity: 'low' | 'medium' | 'high';
};

const INTENSITY_GAIN: Record<HapticSettings['intensity'], number> = {
  low: 0.04,
  medium: 0.08,
  high: 0.14,
};

// Fires the OKO-style pattern for a given event. Silence-on-uncertainty is enforced
// by the caller: this function is simply never invoked when confidence is low —
// see useHazardDetection's "fail silent" gating.
export function fireHapticEvent(event: HapticEvent, settings: HapticSettings) {
  const gain = INTENSITY_GAIN[settings.intensity];

  switch (event) {
    case 'hazard-immediate':
      // Strong continuous vibration + fast descending urgent pulses.
      if (settings.hapticsEnabled) vibrate([0, 180, 60, 180, 60, 180]);
      if (settings.toneEnabled) playTone([880, 660, 440], 260, 'square', gain * 1.4);
      break;
    case 'hazard-nearby':
      // Spaced gentle taps + a single low, calm tone — "not yet, be aware."
      if (settings.hapticsEnabled) vibrate([0, 90, 220, 90]);
      if (settings.toneEnabled) playTone([330], 220, 'sine', gain);
      break;
    case 'clear':
      // Brief single soft tap + rising tone — affirmative, path looks clear.
      if (settings.hapticsEnabled) vibrate(40);
      if (settings.toneEnabled) playTone([440, 660], 220, 'sine', gain * 0.7);
      break;
    case 'landmark':
      // Very light double tap — ambient orientation info, not a hazard.
      if (settings.hapticsEnabled) vibrate([0, 30, 80, 30]);
      if (settings.toneEnabled) playTone([550], 120, 'triangle', gain * 0.5);
      break;
    case 'lost-signal':
      // Descending tone only, no vibration — "I lost track, reposition."
      if (settings.toneEnabled) playTone([660, 440, 220], 400, 'sine', gain * 0.6);
      break;
  }
}
