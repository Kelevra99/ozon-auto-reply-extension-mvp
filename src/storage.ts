import type { ExtensionSettings, Mode } from './types';

export const BACKEND_BASE_URL = 'https://api.finerox.online'\;

export const DEFAULT_SETTINGS: ExtensionSettings = {
  backendBaseUrl: BACKEND_BASE_URL,
  apiKey: '',
  mode: 'expert'
};

function normalizeBaseUrl(_value?: string): string {
  return BACKEND_BASE_URL;
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
    backendBaseUrl: BACKEND_BASE_URL,
    apiKey: typeof settings.apiKey === 'string' ? settings.apiKey.trim() : current.apiKey,
    mode: normalizeMode(settings.mode ?? current.mode)
  };

  await chrome.storage.local.set(next);
  return next;
}
