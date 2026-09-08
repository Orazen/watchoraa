import { useEffect, useState } from 'react';
import { api, ApiError, type AiProviderSettings } from './api';

/**
 * AI provider mode settings (bring-your-own key). The spoken/large-text UI
 * follows the rest of Settings: every control is a real labeled element, and
 * confirmations are announced via the passed-in announce() live region so
 * screen-reader users hear the outcome without hunting for it.
 */
export function AiProviderSection({ announce, speak }: { announce: (message: string, tone?: 'online' | 'busy' | 'warning' | 'error') => void; speak: (text: string) => void }) {
  const [settings, setSettings] = useState<AiProviderSettings | null>(null);
  const [provider, setProvider] = useState<'GEMINI' | 'OPENAI_COMPATIBLE'>('GEMINI');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api
      .getAiProviderSettings()
      .then(({ providerSettings }) => {
        setSettings(providerSettings);
        setProvider(providerSettings.provider);
        setModel(providerSettings.model ?? '');
        setBaseUrl(providerSettings.baseUrl ?? '');
        setLoaded(true);
      })
      .catch(() => {
        announce('Could not load AI provider settings.', 'error');
        setLoaded(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save(includeKey: boolean) {
    if (saving) return;
    if (provider === 'OPENAI_COMPATIBLE' && baseUrl && !/^https:\/\//.test(baseUrl.trim())) {
      announce('Base URL must start with https.', 'warning');
      speak('Base URL must start with HTTPS.');
      return;
    }
    setSaving(true);
    try {
      const { providerSettings } = await api.upsertAiProviderSettings({
        provider,
        model: model.trim() || null,
        baseUrl: provider === 'OPENAI_COMPATIBLE' ? baseUrl.trim() || null : null,
        apiKey: includeKey && apiKey.trim() ? apiKey.trim() : undefined,
      });
      setSettings(providerSettings);
      setApiKey('');
      announce(`AI provider saved. ${providerSettings.provider === 'GEMINI' ? 'Gemini' : 'OpenAI-compatible'}${providerSettings.hasKey ? ' with your key' : ' — no key stored yet'}.`, 'online');
      speak(`AI provider saved.`);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Could not save AI provider settings.';
      announce(message, 'error');
      speak(message);
    } finally {
      setSaving(false);
    }
  }

  async function removeKey() {
    if (saving) return;
    setSaving(true);
    try {
      const { providerSettings } = await api.deleteAiProviderKey();
      setSettings(providerSettings);
      announce('API key removed. Watchora will fall back to the platform AI or demo mode.', 'online');
    } catch (error) {
      announce(error instanceof ApiError ? error.message : 'Could not remove API key.', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) {
    return (
      <div className="settings-section">
        <h3>AI provider</h3>
        <p className="muted-note" role="status" aria-live="polite">Loading…</p>
      </div>
    );
  }

  return (
    <div className="settings-section">
      <h3>AI provider</h3>
      <p className="settings-hint">
        Bring your own AI. Jarvis, scene descriptions and answers will use your provider and key. The key is stored encrypted and is never read back or spoken.
      </p>
      <div className="settings-row">
        <span>Provider</span>
        <select
          value={provider}
          onChange={(event) => setProvider(event.target.value === 'OPENAI_COMPATIBLE' ? 'OPENAI_COMPATIBLE' : 'GEMINI')}
          aria-label="AI provider"
          style={{ maxWidth: '100%' }}
        >
          <option value="GEMINI">Google Gemini</option>
          <option value="OPENAI_COMPATIBLE">OpenAI-compatible (OpenAI, Groq, OpenRouter…)</option>
        </select>
      </div>
      <div className="settings-row">
        <span>Model</span>
        <input
          type="text"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder={provider === 'GEMINI' ? 'gemini-2.5-flash' : 'gpt-4o-mini'}
          aria-label="AI model name"
          style={{ maxWidth: '100%' }}
        />
      </div>
      {provider === 'OPENAI_COMPATIBLE' && (
        <div className="settings-row">
          <span>API base URL</span>
          <input
            type="url"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://api.openai.com/v1"
            aria-label="API base URL"
            style={{ maxWidth: '100%' }}
          />
        </div>
      )}
      <div className="settings-row">
        <span>API key</span>
        <input
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={settings?.hasKey ? `Stored (${settings.maskedKey ?? 'saved'}) — type to replace` : 'Paste your key'}
          aria-label="API key"
          autoComplete="off"
          style={{ maxWidth: '100%' }}
        />
      </div>
      <div className="control-inline">
        <button className="secondary-btn" disabled={saving} onClick={() => save(true)}>
          Save with key
        </button>
        <button className="ghost-btn" disabled={saving || !settings?.hasKey} onClick={() => save(false)}>
          Save without new key
        </button>
        {settings?.hasKey && (
          <button className="ghost-btn" disabled={saving} onClick={removeKey}>
            Remove key
          </button>
        )}
      </div>
    </div>
  );
}
