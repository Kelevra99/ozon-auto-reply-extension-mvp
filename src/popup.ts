import { BACKEND_BASE_URL, DEFAULT_SETTINGS } from './storage';
import type { BackgroundResponse, CheckAuthResponse, ExtensionSettings } from './types';

const enabledInput = document.getElementById('enabled') as HTMLInputElement;
const enabledStateLabel = document.getElementById('enabledStateLabel') as HTMLDivElement;
const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const modeSelect = document.getElementById('mode') as HTMLSelectElement;
const saveButton = document.getElementById('saveButton') as HTMLButtonElement;
const checkButton = document.getElementById('checkButton') as HTMLButtonElement;
const autoStartButton = document.getElementById('autoStartButton') as HTMLButtonElement;
const statusBox = document.getElementById('status') as HTMLDivElement;

let currentEnabled = true;
let currentBusy = false;

async function sendMessage<T>(message: unknown): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as BackgroundResponse<T>;
  if (!response?.ok) {
    throw new Error(response?.error || 'Ошибка расширения');
  }
  return response.data as T;
}

function setStatus(text: string, tone: 'default' | 'success' | 'error' = 'default') {
  statusBox.textContent = text;
  statusBox.className = 'status';
  if (tone !== 'default') statusBox.classList.add(tone);
}

function updateEnabledLabel(enabled: boolean) {
  enabledStateLabel.textContent = enabled ? 'Включено' : 'Выключено';
}

function updateAutoStartAvailability() {
  const hasApiKey = apiKeyInput.value.trim().length > 0;
  autoStartButton.disabled = currentBusy || !currentEnabled || !hasApiKey;
  autoStartButton.className = hasApiKey && currentEnabled && !currentBusy ? 'primary' : 'ghost';
}

function applyAvailability() {
  const disabled = currentBusy || !currentEnabled;

  apiKeyInput.disabled = disabled;
  modeSelect.disabled = disabled;
  saveButton.disabled = disabled;
  checkButton.disabled = disabled;
  enabledInput.disabled = currentBusy;

  updateEnabledLabel(currentEnabled);
  updateAutoStartAvailability();
}

function setBusy(busy: boolean) {
  currentBusy = busy;
  applyAvailability();
}

function humanizeError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  const normalized = message.toLowerCase();

  if (
    normalized.includes('401') ||
    normalized.includes('403') ||
    normalized.includes('unauthorized') ||
    normalized.includes('forbidden') ||
    normalized.includes('invalid') ||
    normalized.includes('api key') ||
    normalized.includes('api-ключ')
  ) {
    return 'API-ключ не подошёл. Проверьте его на сайте kairox.su.';
  }

  if (
    normalized.includes('failed to fetch') ||
    normalized.includes('networkerror') ||
    normalized.includes('load failed')
  ) {
    return 'Не удалось связаться с сервисом. Проверьте интернет и повторите попытку.';
  }

  return message || fallback;
}

function describeEnabledState(enabled: boolean): string {
  return enabled ? 'Включено.' : 'Выключено.';
}

function applySettings(settings: ExtensionSettings) {
  currentEnabled = settings.enabled;
  enabledInput.checked = settings.enabled;
  apiKeyInput.value = settings.apiKey || '';
  modeSelect.value = settings.mode || DEFAULT_SETTINGS.mode;
  applyAvailability();
}

async function persistSettings(): Promise<ExtensionSettings> {
  return sendMessage<ExtensionSettings>({
    type: 'SAVE_SETTINGS',
    payload: {
      backendBaseUrl: BACKEND_BASE_URL,
      apiKey: apiKeyInput.value,
      mode: modeSelect.value,
      enabled: enabledInput.checked
    }
  });
}

async function loadSettings() {
  const settings = await sendMessage<ExtensionSettings>({ type: 'GET_SETTINGS' });
  applySettings(settings);
  setStatus(describeEnabledState(settings.enabled));
}

async function saveSettings() {
  setBusy(true);
  try {
    const settings = await persistSettings();
    applySettings(settings);
    setStatus(
      settings.enabled
        ? 'Настройки сохранены. Включено.'
        : 'Настройки сохранены. Выключено.',
      'success'
    );
  } catch (error) {
    setStatus(humanizeError(error, 'Не удалось сохранить настройки.'), 'error');
  } finally {
    setBusy(false);
  }
}

async function saveEnabledState() {
  setBusy(true);
  try {
    const settings = await sendMessage<ExtensionSettings>({
      type: 'SAVE_SETTINGS',
      payload: {
        enabled: enabledInput.checked
      }
    });

    applySettings(settings);
    setStatus(describeEnabledState(settings.enabled), 'success');
  } catch (error) {
    enabledInput.checked = !enabledInput.checked;
    setStatus(humanizeError(error, 'Не удалось изменить состояние расширения.'), 'error');
  } finally {
    setBusy(false);
  }
}

async function checkConnection() {
  setBusy(true);
  try {
    const settings = await persistSettings();
    applySettings(settings);

    const data = await sendMessage<CheckAuthResponse>({ type: 'CHECK_CONNECTION' });

    if (!data.valid) {
      throw new Error('invalid api key');
    }

    const name = data.user?.name || data.user?.email;
    if (name) {
      setStatus(`Подключение успешно. Аккаунт: ${name}.`, 'success');
    } else {
      setStatus('Подключение успешно.', 'success');
    }
  } catch (error) {
    setStatus(humanizeError(error, 'Не удалось проверить подключение.'), 'error');
  } finally {
    setBusy(false);
  }
}

enabledInput.addEventListener('change', () => {
  void saveEnabledState();
});

apiKeyInput.addEventListener('input', () => {
  updateAutoStartAvailability();
});

saveButton.addEventListener('click', () => {
  void saveSettings();
});

checkButton.addEventListener('click', () => {
  void checkConnection();
});

void loadSettings();
