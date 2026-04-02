import { BACKEND_BASE_URL, DEFAULT_SETTINGS } from './storage';
import type { BackgroundResponse, CheckAuthResponse, ExtensionSettings } from './types';

type AutoModeStatus = {
  available: boolean;
  pageUrl: string | null;
  requested: boolean;
  running: boolean;
  extensionEnabled: boolean;
  statusText: string;
  statusTone: 'default' | 'success' | 'error' | 'warn';
};

const enabledInput = document.getElementById('enabled') as HTMLInputElement;
const enabledStateLabel = document.getElementById('enabledStateLabel') as HTMLDivElement;
const apiKeyInput = document.getElementById('apiKey') as HTMLInputElement;
const modeSelect = document.getElementById('mode') as HTMLSelectElement;
const saveButton = document.getElementById('saveButton') as HTMLButtonElement;
const checkButton = document.getElementById('checkButton') as HTMLButtonElement;
const autoStartButton = document.getElementById('autoStartButton') as HTMLButtonElement;
const closeButton = document.getElementById('closeButton') as HTMLButtonElement | null;
const statusBox = document.getElementById('status') as HTMLDivElement;

let currentEnabled = true;
let currentBusy = false;
let currentAutoActive = false;
let autoPollTimer: number | null = null;

async function sendMessage<T>(message: unknown): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as BackgroundResponse<T>;
  if (!response?.ok) {
    throw new Error(response?.error || 'Ошибка расширения');
  }
  return response.data as T;
}

function setStatus(
  text: string,
  tone: 'default' | 'success' | 'error' = 'default'
) {
  statusBox.textContent = text;
  statusBox.className = 'status';
  if (tone !== 'default') statusBox.classList.add(tone);
}

function updateEnabledLabel(enabled: boolean) {
  enabledStateLabel.textContent = enabled ? 'Включено' : 'Выключено';
}

function updateAutoStartAvailability() {
  const hasApiKey = apiKeyInput.value.trim().length > 0;
  const canUse = !currentBusy && currentEnabled && (currentAutoActive || hasApiKey);

  autoStartButton.disabled = !canUse;

  if (currentAutoActive) {
    autoStartButton.className = 'danger';
    return;
  }

  autoStartButton.className = canUse ? 'primary' : 'ghost';
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
    return 'API-ключ не подошёл. Проверьте его на сайте sellerreply.ru.';
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

function applyAutoModeState(state: AutoModeStatus | null | undefined) {
  const active = Boolean(state?.requested || state?.running);
  currentAutoActive = active;

  autoStartButton.dataset.active = active ? 'true' : 'false';
  autoStartButton.textContent = active
    ? 'Остановить автоответ'
    : 'Запустить автоответ';

  updateAutoStartAvailability();
}

async function persistSettingsWithEnabled(enabled: boolean): Promise<ExtensionSettings> {
  return sendMessage<ExtensionSettings>({
    type: 'SAVE_SETTINGS',
    payload: {
      backendBaseUrl: BACKEND_BASE_URL,
      apiKey: apiKeyInput.value,
      mode: modeSelect.value,
      enabled
    }
  });
}

async function loadSettings() {
  const settings = await sendMessage<ExtensionSettings>({ type: 'GET_SETTINGS' });
  applySettings(settings);
  setStatus(describeEnabledState(settings.enabled));
}

async function loadAutoModeState(silent = false) {
  try {
    const state = await sendMessage<AutoModeStatus>({ type: 'GET_AUTO_MODE_STATUS' });
    applyAutoModeState(state);

    if (!currentBusy && state?.statusText) {
      const tone =
        state.statusTone === 'error'
          ? 'error'
          : state.statusTone === 'success'
          ? 'success'
          : 'default';

      setStatus(state.statusText, tone);
    }
  } catch (error) {
    if (!silent) {
      setStatus(humanizeError(error, 'Не удалось получить состояние автоответа.'), 'error');
    }
  }
}

async function saveSettings() {
  setBusy(true);
  try {
    const settings = await persistSettingsWithEnabled(enabledInput.checked);
    applySettings(settings);
    setStatus(
      settings.enabled
        ? 'Настройки сохранены. Включено.'
        : 'Настройки сохранены. Выключено.',
      'success'
    );
    await loadAutoModeState(true);
  } catch (error) {
    setStatus(humanizeError(error, 'Не удалось сохранить настройки.'), 'error');
  } finally {
    setBusy(false);
  }
}

async function saveEnabledState() {
  setBusy(true);

  try {
    const nextEnabled = enabledInput.checked;

    if (!nextEnabled) {
      try {
        await sendMessage<AutoModeStatus>({
          type: 'POPUP_SET_AUTO_MODE',
          payload: { enabled: false }
        });
      } catch {
        // ignore
      }
      applyAutoModeState({
        available: false,
        pageUrl: null,
        requested: false,
        running: false,
        extensionEnabled: false,
        statusText: 'Автоответ остановлен.',
        statusTone: 'default'
      });
    }

    const settings = await sendMessage<ExtensionSettings>({
      type: 'SAVE_SETTINGS',
      payload: { enabled: nextEnabled }
    });

    applySettings(settings);

    if (settings.enabled) {
      await loadAutoModeState(true);
    } else {
      applyAutoModeState({
        available: false,
        pageUrl: null,
        requested: false,
        running: false,
        extensionEnabled: false,
        statusText: 'Автоответ остановлен.',
        statusTone: 'default'
      });
    }

    setStatus(describeEnabledState(settings.enabled), 'success');
  } catch (error) {
    enabledInput.checked = !enabledInput.checked;
    setStatus(
      humanizeError(error, 'Не удалось изменить состояние расширения.'),
      'error'
    );
  } finally {
    setBusy(false);
  }
}

async function checkConnection() {
  setBusy(true);
  try {
    const settings = await persistSettingsWithEnabled(enabledInput.checked);
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

async function toggleAutoMode() {
  const shouldEnable = !currentAutoActive;

  setBusy(true);

  try {
    if (shouldEnable) {
      const settings = await persistSettingsWithEnabled(true);
      applySettings(settings);

      if (!settings.apiKey) {
        throw new Error('Сначала введите API-ключ, полученный на сайте sellerreply.ru.');
      }
    }

    const state = await sendMessage<AutoModeStatus>({
      type: 'POPUP_SET_AUTO_MODE',
      payload: { enabled: shouldEnable }
    });

    applyAutoModeState(state);
    await loadSettings();
    await loadAutoModeState(true);

    setStatus(
      shouldEnable ? 'Автоответ запускается...' : 'Автоответ остановлен.',
      'success'
    );
  } catch (error) {
    setStatus(
      humanizeError(error, 'Не удалось изменить состояние автоответа.'),
      'error'
    );
  } finally {
    setBusy(false);
  }
}

function startAutoPolling() {
  if (autoPollTimer !== null) {
    window.clearInterval(autoPollTimer);
  }

  autoPollTimer = window.setInterval(() => {
    void loadAutoModeState(true);
  }, 1200);
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

autoStartButton.addEventListener('click', () => {
  void toggleAutoMode();
});

closeButton?.addEventListener('click', () => {
  window.close();
});

void (async () => {
  try {
    await loadSettings();
    await loadAutoModeState(true);
    startAutoPolling();
  } catch (error) {
    setStatus(
      humanizeError(error, 'Не удалось загрузить настройки расширения.'),
      'error'
    );
  }
})();
