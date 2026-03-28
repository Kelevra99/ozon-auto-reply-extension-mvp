import type { ExtensionSettings, Mode } from './types';

export const DEFAULT_SETTINGS: ExtensionSettings = {
  backendBaseUrl: 'http://localhost:3001',
  apiKey: '',
  mode: 'advanced'
};

function normalizeBaseUrl(value?: string): string {
  const raw = (value ?? '').trim();
  if (!raw) return DEFAULT_SETTINGS.backendBaseUrl;
  return raw.replace(/\/+$/, '');
}

function normalizeMode(value?: string): Mode {
  if (value === 'standard' || value === 'advanced' || value === 'expert') {
    return value;
  }
  return DEFAULT_SETTINGS.mode;
}

export async function getSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  return {
    backendBaseUrl: normalizeBaseUrl(stored.backendBaseUrl),
    apiKey: typeof stored.apiKey === 'string' ? stored.apiKey.trim() : '',
    mode: normalizeMode(stored.mode)
  };
}

export async function saveSettings(settings: Partial<ExtensionSettings>): Promise<ExtensionSettings> {
  const current = await getSettings();
  const next: ExtensionSettings = {
    backendBaseUrl: normalizeBaseUrl(settings.backendBaseUrl ?? current.backendBaseUrl),
    apiKey: typeof settings.apiKey === 'string' ? settings.apiKey.trim() : current.apiKey,
    mode: normalizeMode(settings.mode ?? current.mode)
  };

  await chrome.storage.local.set(next);
  return next;
}
