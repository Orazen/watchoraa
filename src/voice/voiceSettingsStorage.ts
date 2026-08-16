// Voice settings persistence. Settings are stored in localStorage so a user
// who enables hands-free voice control keeps it across sessions — a blind
// user should not have to re-enable their preferred control mode on every
// visit. Storage is injectable so tests can run without a real localStorage.

import type { VoiceSettings } from './voiceTypes';

export const VOICE_SETTINGS_STORAGE_KEY = 'watchora:voice-settings';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** Loads stored settings merged over the fallback. Never throws. */
export function loadVoiceSettings(fallback: VoiceSettings, storage: StorageLike | null = defaultStorage()): VoiceSettings {
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(VOICE_SETTINGS_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<VoiceSettings>;
    if (typeof parsed !== 'object' || parsed === null) return fallback;
    // Only accept known boolean fields so a corrupt store cannot flip the
    // app into a surprising state.
    const clean: Partial<VoiceSettings> = {};
    if (typeof parsed.wakePhraseEnabled === 'boolean') clean.wakePhraseEnabled = parsed.wakePhraseEnabled;
    if (typeof parsed.pushToTalk === 'boolean') clean.pushToTalk = parsed.pushToTalk;
    if (typeof parsed.language === 'string' && parsed.language) clean.language = parsed.language;
    if (typeof parsed.voice === 'string' && parsed.voice) clean.voice = parsed.voice;
    if (typeof parsed.speechRate === 'number' && Number.isFinite(parsed.speechRate)) clean.speechRate = parsed.speechRate;
    if (parsed.verbosity === 0 || parsed.verbosity === 1 || parsed.verbosity === 2) clean.verbosity = parsed.verbosity;
    return { ...fallback, ...clean };
  } catch {
    return fallback;
  }
}

/** Persists settings. Never throws. */
export function saveVoiceSettings(settings: VoiceSettings, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(VOICE_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Quota errors or private mode: ignore, hands-free still works this session.
  }
}
