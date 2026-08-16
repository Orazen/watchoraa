import { describe, expect, it } from 'vitest';
import { loadVoiceSettings, saveVoiceSettings, VOICE_SETTINGS_STORAGE_KEY } from '../voiceSettingsStorage';
import { DEFAULT_VOICE_SETTINGS, type VoiceSettings } from '../voiceTypes';

function makeStorage(): { store: Map<string, string>; getItem: (k: string) => string | null; setItem: (k: string, v: string) => void } {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, v);
    },
  };
}

describe('voice settings storage', () => {
  it('returns the fallback when nothing is stored', () => {
    const storage = makeStorage();
    expect(loadVoiceSettings(DEFAULT_VOICE_SETTINGS, storage)).toEqual(DEFAULT_VOICE_SETTINGS);
  });

  it('persists and reloads settings', () => {
    const storage = makeStorage();
    const custom: VoiceSettings = { ...DEFAULT_VOICE_SETTINGS, wakePhraseEnabled: false, pushToTalk: true };
    saveVoiceSettings(custom, storage);
    expect(loadVoiceSettings(DEFAULT_VOICE_SETTINGS, storage)).toEqual(custom);
    expect(storage.store.get(VOICE_SETTINGS_STORAGE_KEY)).toContain('"pushToTalk":true');
  });

  it('ignores a corrupt store and falls back to defaults', () => {
    const storage = makeStorage();
    storage.setItem(VOICE_SETTINGS_STORAGE_KEY, '{not json');
    expect(loadVoiceSettings(DEFAULT_VOICE_SETTINGS, storage)).toEqual(DEFAULT_VOICE_SETTINGS);
  });

  it('ignores non-boolean wakePhraseEnabled from a hostile store', () => {
    const storage = makeStorage();
    storage.setItem(VOICE_SETTINGS_STORAGE_KEY, JSON.stringify({ wakePhraseEnabled: 'yes', pushToTalk: 1 }));
    const loaded = loadVoiceSettings(DEFAULT_VOICE_SETTINGS, storage);
    expect(loaded.wakePhraseEnabled).toBe(true);
    expect(loaded.pushToTalk).toBe(false);
  });

  it('never throws when storage is unavailable', () => {
    expect(loadVoiceSettings(DEFAULT_VOICE_SETTINGS, null)).toEqual(DEFAULT_VOICE_SETTINGS);
    expect(() => saveVoiceSettings(DEFAULT_VOICE_SETTINGS, null)).not.toThrow();
  });

  it('defaults to hands-free with wake phrase enabled', () => {
    expect(DEFAULT_VOICE_SETTINGS.pushToTalk).toBe(false);
    expect(DEFAULT_VOICE_SETTINGS.wakePhraseEnabled).toBe(true);
  });
});
