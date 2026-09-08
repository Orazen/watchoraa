// VoiceFirstShell: composes the single voice-assistant provider, live
// announcer, and permission service around the app. Bridges voice output and
// commands into MainApp through a stable ref so the provider never duplicates
// speech systems.

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { LiveAnnouncer } from './accessibility/LiveAnnouncer';
import { PermissionService } from './permissions/permissionService';
import { VoiceAssistantProvider } from './voice/VoiceAssistantProvider';
import { BackendIntentParser, getRecentCommandContext } from './voice/aiIntentParser';
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
        const context = getRecentCommandContext() || undefined;
        const r = await import('./api').then((m) => m.api.aiIntent(transcript, context));
        if (!r || r.intent === 'unknown' || !r.intent) return null;
        const toSubIntent = (c: { intent: string; parameters: Record<string, string | number | boolean>; confidence: number; requiresConfirmation: boolean }): VoiceIntent => ({
          intent: c.intent as VoiceIntent['intent'],
          parameters: c.parameters,
          confidence: c.confidence,
          requiresConfirmation: c.requiresConfirmation,
          deterministic: false,
        });
        // Compound commands: the server pre-validated each entry against the
        // safe allow-list; unknown parts were already dropped server-side.
        // Server mirrors the primary command at commands[0], so keep only the
        // entries AFTER it — runCommand executes those on top of the primary.
        const commands = Array.isArray(r.commands) ? r.commands.slice(1, 3).map(toSubIntent) : undefined;
        return {
          ...toSubIntent(r),
          commands,
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
