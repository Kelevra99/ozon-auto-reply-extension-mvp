import { DEFAULT_SETTINGS } from './storage';
import type { BackgroundResponse, CheckAuthResponse, ExtensionSettings } from './types';

const backendBaseUrlInput = document.getElementById('backendBaseUrl') as HTMLInputElement;
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

async function loadSettings() {
  const settings = await sendMessage<ExtensionSettings>({ type: 'GET_SETTINGS' });
  backendBaseUrlInput.value = settings.backendBaseUrl || DEFAULT_SETTINGS.backendBaseUrl;
  apiKeyInput.value = settings.apiKey || '';
  modeSelect.value = settings.mode || DEFAULT_SETTINGS.mode;
}

async function saveSettings() {
  setBusy(true);
  try {
    const settings = await sendMessage<ExtensionSettings>({
      type: 'SAVE_SETTINGS',
      payload: {
        backendBaseUrl: backendBaseUrlInput.value,
        apiKey: apiKeyInput.value,
        mode: modeSelect.value
      }
    });

    backendBaseUrlInput.value = settings.backendBaseUrl;
    apiKeyInput.value = settings.apiKey;
    modeSelect.value = settings.mode;

    setStatus('Настройки сохранены.', 'success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Не удалось сохранить настройки', 'error');
  } finally {
    setBusy(false);
  }
}

async function checkConnection() {
  setBusy(true);
  try {
    await saveSettings();
    const data = await sendMessage<CheckAuthResponse>({ type: 'CHECK_CONNECTION' });
    if (!data.valid) {
      throw new Error('Backend вернул valid=false');
    }

    const name = data.user?.name || data.user?.email || 'пользователь';
    const modes = data.limits?.mode?.join(', ') || 'не указаны';
    setStatus(`Соединение успешно. Пользователь: ${name}. Доступные режимы: ${modes}`, 'success');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Ошибка проверки соединения', 'error');
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
