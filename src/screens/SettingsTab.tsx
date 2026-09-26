import { AudioLines, BrainCircuit, History, LogOut, MessageSquareText, SlidersHorizontal, UserRound } from 'lucide-react';
import { AiProviderSection } from '../AiProviderSettings';
import type { PublicUser, ReadingEntry, TtsVoice } from '../api';
import type { HapticSettings } from '../haptics';
import type { SpeechPriority } from '../speechPriority';
import type { VoiceSettings } from '../voice/voiceTypes';
import type { Tone } from './shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Field,
  Select,
  cn,
} from '../components/ui';

/** One labelled row of the instrument panel: name on the left, control/value on the right. */
function SettingsRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-sm font-semibold text-foreground">{label}</span>
      {children}
    </div>
  );
}

export function SettingsTab({
  user,
  language,
  themeMode,
  onThemeChange,
  voiceRate,
  onVoiceRateChange,
  voice,
  voices,
  onVoiceChange,
  onTestVoice,
  hapticSettings,
  onHapticSettingsChange,
  onTestHaptic,
  voiceSettings,
  onVoiceSettingsChange,
  onLogout,
  readingEntries,
  onDeleteReading,
  announce,
  speak,
}: {
  user: PublicUser;
  language: string;
  themeMode: 'Light' | 'Dark';
  onThemeChange: (mode: 'Light' | 'Dark') => void;
  voiceRate: number;
  onVoiceRateChange: (updater: (current: number) => number) => void;
  voice: string;
  voices: TtsVoice[] | null;
  onVoiceChange: (voice: string) => void;
  onTestVoice: () => void;
  hapticSettings: HapticSettings;
  onHapticSettingsChange: (updater: (current: HapticSettings) => HapticSettings) => void;
  onTestHaptic: () => void;
  voiceSettings: VoiceSettings;
  onVoiceSettingsChange: (patch: Partial<VoiceSettings>) => void;
  onLogout: () => void;
  readingEntries: ReadingEntry[] | null;
  onDeleteReading: (id: string) => void;
  announce: (message: string, tone?: Tone) => void;
  speak: (text: string, priority?: SpeechPriority, dedupeKey?: string, rateOverride?: number) => void;
}) {
  // Group voices by language so the picker reads naturally (e.g. हिन्दी).
  const voiceGroups: Array<[string, TtsVoice[]]> = [];
  if (voices) {
    const byLang = new Map<string, TtsVoice[]>();
    for (const v of voices) {
      const key = `${v.language} · ${v.native}`;
      const arr = byLang.get(key) ?? [];
      arr.push(v);
      byLang.set(key, arr);
    }
    for (const [lang, list] of byLang) voiceGroups.push([lang, list]);
    voiceGroups.sort((a, b) => a[0].localeCompare(b[0]));
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5">
            <UserRound aria-hidden="true" className="size-5 shrink-0 text-primary" />
            Profile
          </CardTitle>
          <CardDescription className="flex items-center gap-2">
            <span className="truncate font-medium text-foreground">{user.fullName}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{user.email}</span>
          </CardDescription>
        </CardHeader>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5">
            <AudioLines aria-hidden="true" className="size-5 shrink-0 text-primary" />
            Voice &amp; audio
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <SettingsRow label="Language">
            <Badge tone="neutral">{language}</Badge>
          </SettingsRow>
          <Field label="Neural voice" htmlFor="settings-voice">
            <Select
              id="settings-voice"
              value={voice}
              onChange={(event) => onVoiceChange(event.target.value)}
              aria-label="Neural voice"
            >
              {voiceGroups.length === 0 ? (
                <option value={voice}>{voice}</option>
              ) : (
                voiceGroups.map(([lang, list]) => (
                  <optgroup key={lang} label={lang}>
                    {list.map((v) => (
                      <option key={v.shortName} value={v.shortName}>
                        {v.gender === 'Female' ? '👩' : '👨'} {v.shortName.replace(/-Neural$/, '')}
                      </option>
                    ))}
                  </optgroup>
                ))
              )}
            </Select>
          </Field>
          <SettingsRow label="Reading speed">
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="icon"
                aria-label="Slower"
                onClick={() => onVoiceRateChange((current) => Math.max(0.7, Number((current - 0.1).toFixed(2))))}
              >
                -
              </Button>
              <Badge tone="outline" className="min-w-16 justify-center tabular-nums">
                {voiceRate.toFixed(2)}x
              </Badge>
              <Button
                variant="outline"
                size="icon"
                aria-label="Faster"
                onClick={() => onVoiceRateChange((current) => Math.min(1.5, Number((current + 0.1).toFixed(2))))}
              >
                +
              </Button>
            </div>
          </SettingsRow>
          <Button variant="outline" onClick={onTestVoice} className="self-start">
            <span aria-hidden="true">🔊</span> Test voice
          </Button>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5">
            <MessageSquareText aria-hidden="true" className="size-5 shrink-0 text-primary" />
            Verbosity &amp; instructions
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold text-foreground">Detail level</span>
            <div
              role="radiogroup"
              aria-label="Speech detail level"
              aria-describedby="settings-verbosity-hint"
              className="flex flex-wrap gap-2"
            >
              {([0, 1, 2] as const).map((level) => (
                <Button
                  key={level}
                  role="radio"
                  aria-checked={voiceSettings.verbosity === level}
                  variant={voiceSettings.verbosity === level ? 'secondary' : 'outline'}
                  onClick={() => onVoiceSettingsChange({ verbosity: level })}
                >
                  {level === 0 ? 'Essential' : level === 1 ? 'Standard' : 'Detailed'}
                </Button>
              ))}
            </div>
            <p id="settings-verbosity-hint" className="text-sm text-muted-foreground">
              Essential speaks only hazards, deviations and emergencies. Standard adds navigation and answers. Detailed
              adds background narration. Emergency warnings always speak, at every level.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={!voiceSettings.pushToTalk}
            onClick={() => onVoiceSettingsChange({ pushToTalk: !voiceSettings.pushToTalk })}
            className={cn(
              'flex w-full items-center justify-between gap-4 rounded-xl border-2 p-4 text-left transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              !voiceSettings.pushToTalk ? 'border-primary/60 bg-primary/10' : 'border-foreground/25 bg-muted/40',
            )}
          >
            <span className="flex flex-col gap-1">
              <strong>Hands-free voice control</strong>
              <p className="text-sm text-muted-foreground">
                Watchora listens continuously so you can speak commands without touching the screen. Say "Hey Watchora",
                then your command.
              </p>
            </span>
            <Badge tone={!voiceSettings.pushToTalk ? 'success' : 'neutral'} aria-hidden="true" className="shrink-0">
              {!voiceSettings.pushToTalk ? 'On' : 'Off'}
            </Badge>
          </button>
          {!voiceSettings.pushToTalk && (
            <button
              type="button"
              role="switch"
              aria-checked={voiceSettings.wakePhraseEnabled}
              onClick={() => onVoiceSettingsChange({ wakePhraseEnabled: !voiceSettings.wakePhraseEnabled })}
              className={cn(
                'flex w-full items-center justify-between gap-4 rounded-xl border-2 p-4 text-left transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                voiceSettings.wakePhraseEnabled ? 'border-primary/60 bg-primary/10' : 'border-foreground/25 bg-muted/40',
              )}
            >
              <span className="flex flex-col gap-1">
                <strong>Wake phrase</strong>
                <p className="text-sm text-muted-foreground">
                  Only act after hearing "Hey Watchora". Keeps casual conversation private. Turn off to respond to every
                  command directly.
                </p>
              </span>
              <Badge
                tone={voiceSettings.wakePhraseEnabled ? 'success' : 'neutral'}
                aria-hidden="true"
                className="shrink-0"
              >
                {voiceSettings.wakePhraseEnabled ? 'On' : 'Off'}
              </Badge>
            </button>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5">
            <SlidersHorizontal aria-hidden="true" className="size-5 shrink-0 text-primary" />
            Display &amp; haptics
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <SettingsRow label="Theme">
            <Button variant="outline" onClick={() => onThemeChange(themeMode === 'Light' ? 'Dark' : 'Light')}>
              Theme: {themeMode}
            </Button>
          </SettingsRow>
          <div className="flex flex-col gap-4 border-t-2 border-foreground/10 pt-4">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Hazard alerts</h4>
            <p className="text-sm text-muted-foreground">
              Controls for the local, camera-based hazard layer (Assist tab). Follows a fail-silent design: when
              detection confidence is low, nothing fires rather than guessing — see the audit notes in
              docs/yolo-ocr-slam-plan.md.
            </p>
            <SettingsRow label="Vibration">
              <Button
                variant={hapticSettings.hapticsEnabled ? 'secondary' : 'outline'}
                aria-pressed={hapticSettings.hapticsEnabled}
                onClick={() => onHapticSettingsChange((current) => ({ ...current, hapticsEnabled: !current.hapticsEnabled }))}
              >
                {hapticSettings.hapticsEnabled ? 'On' : 'Off'}
              </Button>
            </SettingsRow>
            <SettingsRow label="Alert tones">
              <Button
                variant={hapticSettings.toneEnabled ? 'secondary' : 'outline'}
                aria-pressed={hapticSettings.toneEnabled}
                onClick={() => onHapticSettingsChange((current) => ({ ...current, toneEnabled: !current.toneEnabled }))}
              >
                {hapticSettings.toneEnabled ? 'On' : 'Off'}
              </Button>
            </SettingsRow>
            <SettingsRow label="Intensity">
              <div className="flex flex-wrap gap-2">
                {(['low', 'medium', 'high'] as const).map((level) => (
                  <Button
                    key={level}
                    variant={hapticSettings.intensity === level ? 'secondary' : 'outline'}
                    aria-pressed={hapticSettings.intensity === level}
                    onClick={() => onHapticSettingsChange((current) => ({ ...current, intensity: level }))}
                  >
                    {level}
                  </Button>
                ))}
              </div>
            </SettingsRow>
            <Button variant="outline" onClick={onTestHaptic} className="self-start">
              <span aria-hidden="true">📳</span> Test hazard alert
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5">
            <BrainCircuit aria-hidden="true" className="size-5 shrink-0 text-primary" />
            AI provider
          </CardTitle>
        </CardHeader>
        <CardContent>
          <AiProviderSection announce={announce} speak={(text) => speak(text)} />
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5">
            <LogOut aria-hidden="true" className="size-5 shrink-0 text-primary" />
            Account
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SettingsRow label="Role">
            <Badge tone="neutral">{user.role}</Badge>
          </SettingsRow>
        </CardContent>
        <CardFooter>
          <Button variant="destructive" size="lg" onClick={onLogout}>
            Log out
          </Button>
        </CardFooter>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2.5">
            <History aria-hidden="true" className="size-5 shrink-0 text-primary" />
            Reading history
          </CardTitle>
        </CardHeader>
        <CardContent>
          {readingEntries === null ? (
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">Loading…</p>
          ) : readingEntries.length === 0 ? (
            <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
              No saved readings yet. In Assist mode, switch to Reading and use “Save to reading history”.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {readingEntries.slice(0, 10).map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-3 rounded-lg border-2 border-foreground/15 bg-muted/30 p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{entry.source}</p>
                    <p className="text-xs text-muted-foreground">{new Date(entry.createdAt).toLocaleString()}</p>
                  </div>
                  <Button variant="outline" size="md" onClick={() => onDeleteReading(entry.id)} aria-label="Delete reading entry">
                    Delete
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
