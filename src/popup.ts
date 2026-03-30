import { BACKEND_BASE_URL, DEFAULT_SETTINGS } from './storage';
import type { BackgroundResponse, CheckAuthResponse, ExtensionSettings } from './types';

const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const modeSelect = document.getElementById('mode') as HTMLSelectElement;
const saveButton = document.getElementById('saveButton') as HTMLButtonElement;
const checkButton = document.getElementById('checkButton') as HTMLButtonElement;
const statusBox = document.getElementById('status') as HTMLDivElement;

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

function setBusy(busy: boolean) {
  saveButton.disabled = busy;
  checkButton.disabled = busy;
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
    return 'API-ключ не подошёл. Проверьте его на сайте finerox.online.';
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

async function persistSettings(): Promise<ExtensionSettings> {
  return sendMessage<ExtensionSettings>({
    type: 'SAVE_SETTINGS',
    payload: {
      backendBaseUrl: BACKEND_BASE_URL,
      apiKey: apiKeyInput.value,
      mode: modeSelect.value
    }
  });
}

async function loadSettings() {
  const settings = await sendMessage<ExtensionSettings>({ type: 'GET_SETTINGS' });
  apiKeyInput.value = settings.apiKey || '';
  modeSelect.value = settings.mode || DEFAULT_SETTINGS.mode;
}

async function saveSettings() {
  setBusy(true);
  try {
    const settings = await persistSettings();

    apiKeyInput.value = settings.apiKey;
    modeSelect.value = settings.mode;

    setStatus('Настройки сохранены.', 'success');
  } catch (error) {
    setStatus(humanizeError(error, 'Не удалось сохранить настройки.'), 'error');
  } finally {
    setBusy(false);
  }
}

async function checkConnection() {
  setBusy(true);
  try {
    const settings = await persistSettings();

    apiKeyInput.value = settings.apiKey;
    modeSelect.value = settings.mode;

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

saveButton.addEventListener('click', () => {
  void saveSettings();
});

checkButton.addEventListener('click', () => {
  void checkConnection();
});

void loadSettings();
