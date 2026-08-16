// VoiceFirstShell: composes the single voice-assistant provider, live
// announcer, and permission service around the app. Bridges voice output and
// commands into MainApp through a stable ref so the provider never duplicates
// speech systems.

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { LiveAnnouncer } from './accessibility/LiveAnnouncer';
import { PermissionService } from './permissions/permissionService';
import { VoiceAssistantProvider } from './voice/VoiceAssistantProvider';
import { BackendIntentParser } from './voice/aiIntentParser';
import type { VoiceIntent } from './voice/voiceTypes';

export interface VoiceBridge {
  speak: (text: string, priority?: number, dedupeKey?: string) => void;
  handleCommand: (intent: VoiceIntent) => void;
  /** Stops any in-progress speech (barge-in when the user starts talking). */
  stopSpeaking: () => void;
  /**
   * Speech lifecycle signal. App.tsx sets this callback; the voice provider
   * subscribes so it can pause microphone recognition while Watchora itself
   * is speaking (otherwise the mic hears its own voice and can loop).
   */
  onSpeechChange: ((speaking: boolean) => void) | null;
}

export function createVoiceBridge(): VoiceBridge {
  return { speak: () => {}, handleCommand: () => {}, stopSpeaking: () => {}, onSpeechChange: null };
}

const PermissionCtx = createContext<PermissionService | null>(null);

export function usePermissionService(): PermissionService {
  const s = useContext(PermissionCtx);
  if (!s) throw new Error('usePermissionService must be used inside VoiceFirstShell');
  return s;
}

export function VoiceFirstShell({ bridge, children }: { bridge: { current: VoiceBridge }; children: ReactNode }) {
  const permissionService = useMemo(() => new PermissionService(), []);
  const aiParser = useMemo(
    () =>
      new BackendIntentParser(async (transcript: string) => {
        const r = await import('./api').then((m) => m.api.aiIntent(transcript));
        if (!r || r.intent === 'unknown' || !r.intent) return null;
        return {
          intent: r.intent as VoiceIntent['intent'],
          parameters: r.parameters,
          confidence: r.confidence,
          requiresConfirmation: r.requiresConfirmation,
          deterministic: false,
        };
      }),
    [],
  );

  return (
    <PermissionCtx.Provider value={permissionService}>
      <LiveAnnouncer>
        <VoiceAssistantProvider
          speak={(text, priority, dedupeKey) => bridge.current.speak(text, priority, dedupeKey)}
          onCommand={(intent) => bridge.current.handleCommand(intent)}
          onBargeIn={() => bridge.current.stopSpeaking()}
          aiParser={aiParser}
          bridge={bridge}
        >
          {children}
        </VoiceAssistantProvider>
      </LiveAnnouncer>
    </PermissionCtx.Provider>
  );
}
