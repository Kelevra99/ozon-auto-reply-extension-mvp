import { checkConnection, generateReply, reportReplyResult } from './api';
import { getSettings, saveSettings } from './storage';

const REVIEWS_URL = 'https://seller.ozon.ru/app/reviews';
const AUTO_MODE_STORAGE_KEY = 'fineroxAutoReplyEnabled';

type AutoModeStatus = {
  available: boolean;
  pageUrl: string | null;
  requested: boolean;
  running: boolean;
  extensionEnabled: boolean;
  statusText: string;
  statusTone: 'default' | 'success' | 'error' | 'warn';
};

chrome.runtime.onInstalled.addListener(async () => {
  await saveSettings({});
});

chrome.runtime.onMessage.addListener((message: any, _sender, sendResponse) => {
  void handleMessage(message)
    .then((response) => sendResponse(response))
    .catch((error: unknown) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : 'Неизвестная ошибка'
      });
    });

  return true;
});

async function handleMessage(message: any): Promise<any> {
  switch (message?.type) {
    case 'GET_SETTINGS': {
      const settings = await getSettings();
      return { ok: true, data: settings };
    }

    case 'SAVE_SETTINGS': {
      const settings = await saveSettings(message.payload ?? {});
      return { ok: true, data: settings };
    }

    case 'CHECK_CONNECTION': {
      const settings = await getSettings();
      const data = await checkConnection(settings);
      return { ok: true, data };
    }

    case 'GENERATE_REPLY': {
      const settings = await getSettings();
      const data = await generateReply(settings, message.payload);
      return { ok: true, data };
    }

    case 'REPORT_RESULT': {
      const settings = await getSettings();
      const data = await reportReplyResult(settings, message.payload);
      return { ok: true, data };
    }

    case 'GET_AUTO_MODE_STATUS': {
      const data = await getAutoModeStatus();
      return { ok: true, data };
    }

    case 'POPUP_SET_AUTO_MODE': {
      const enabled = Boolean(message?.payload?.enabled);
      const data = enabled
        ? await startAutoModeFromPopup()
        : await stopAutoModeFromPopup();
      return { ok: true, data };
    }

    default:
      return { ok: false, error: 'Неподдерживаемый тип сообщения' };
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function isReviewsUrl(url?: string | null): boolean {
  return typeof url === 'string' && url.startsWith(REVIEWS_URL);
}

function buildStatus(
  overrides: Partial<AutoModeStatus> = {}
): AutoModeStatus {
  return {
    available: false,
    pageUrl: null,
    requested: false,
    running: false,
    extensionEnabled: true,
    statusText: 'Автоответ остановлен.',
    statusTone: 'default',
    ...overrides
  };
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] ?? null;
}

async function listReviewTabs(): Promise<chrome.tabs.Tab[]> {
  return chrome.tabs.query({
    url: [
      'https://seller.ozon.ru/app/reviews*',
      'https://*.seller.ozon.ru/app/reviews*',
      'https://*.ozon.ru/app/reviews*'
    ]
  });
}

async function getPreferredReviewTab(
  activeTab?: chrome.tabs.Tab | null
): Promise<chrome.tabs.Tab | null> {
  const currentActive = activeTab ?? (await getActiveTab());

  if (currentActive?.id && isReviewsUrl(currentActive.url)) {
    return currentActive;
  }

  const tabs = await listReviewTabs();

  if (currentActive?.windowId) {
    const sameWindow = tabs.find((tab) => tab.windowId === currentActive.windowId);
    if (sameWindow) return sameWindow;
  }

  return tabs[0] ?? null;
}

async function waitForTabComplete(tabId: number, timeoutMs = 30000): Promise<void> {
  const existing = await chrome.tabs.get(tabId);
  if (existing.status === 'complete') return;

  await new Promise<void>((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      cleanup();
      reject(new Error('Страница OZON не загрузилась вовремя'));
    }, timeoutMs);

    const onUpdated = (
      updatedTabId: number,
      changeInfo: chrome.tabs.TabChangeInfo
    ) => {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === 'complete') {
        cleanup();
        resolve();
      }
    };

    const onRemoved = (removedTabId: number) => {
      if (removedTabId !== tabId) return;
      cleanup();
      reject(new Error('Вкладка OZON была закрыта'));
    };

    function cleanup() {
      globalThis.clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
}

async function sendMessageToTab(tabId: number, message: any): Promise<any> {
  return chrome.tabs.sendMessage(tabId, message);
}

async function getAutoModeStatus(): Promise<AutoModeStatus> {
  const settings = await getSettings();
  const activeTab = await getActiveTab();
  const reviewTab = await getPreferredReviewTab(activeTab);

  const fallback = buildStatus({
    pageUrl: activeTab?.url ?? reviewTab?.url ?? null,
    extensionEnabled: settings.enabled
  });

  if (!reviewTab?.id) {
    return fallback;
  }

  try {
    const response = await sendMessageToTab(reviewTab.id, { type: 'GET_AUTO_MODE_STATUS' });
    if (response?.ok && response.data) {
      return {
        ...fallback,
        ...response.data,
        available: true,
        pageUrl: response.data.pageUrl ?? reviewTab.url ?? fallback.pageUrl
      };
    }
  } catch {
    // ignore
  }

  return {
    ...fallback,
    available: true,
    pageUrl: reviewTab.url ?? fallback.pageUrl
  };
}

async function startAutoModeFromPopup(): Promise<AutoModeStatus> {
  const settings = await getSettings();

  if (!settings.apiKey) {
    throw new Error('Сначала введите API-ключ, полученный на сайте kairox.su.');
  }

  if (!settings.enabled) {
    await saveSettings({ enabled: true });
  }

  await chrome.storage.local.set({ [AUTO_MODE_STORAGE_KEY]: true });

  let activeTab = await getActiveTab();

  if (!activeTab?.id) {
    activeTab = await chrome.tabs.create({
      url: REVIEWS_URL,
      active: true
    });
  } else if (!isReviewsUrl(activeTab.url)) {
    activeTab = await chrome.tabs.update(activeTab.id, { url: REVIEWS_URL });
  }

  if (!activeTab?.id) {
    return buildStatus({
      available: true,
      pageUrl: REVIEWS_URL,
      requested: true,
      running: true,
      extensionEnabled: true,
      statusText: 'Запускаю автоответ...'
    });
  }

  await waitForTabComplete(activeTab.id);
  await wait(700);

  try {
    await sendMessageToTab(activeTab.id, { type: 'START_AUTO_MODE_FROM_POPUP' });
  } catch {
    await wait(1200);
    try {
      await sendMessageToTab(activeTab.id, { type: 'START_AUTO_MODE_FROM_POPUP' });
    } catch {
      // content.ts сам восстановит запуск по storage
    }
  }

  const refreshedTab = await chrome.tabs.get(activeTab.id);

  return buildStatus({
    available: true,
    pageUrl: refreshedTab.url ?? REVIEWS_URL,
    requested: true,
    running: true,
    extensionEnabled: true,
    statusText: 'Запускаю автоответ...'
  });
}

async function stopAutoModeFromPopup(): Promise<AutoModeStatus> {
  await chrome.storage.local.set({ [AUTO_MODE_STORAGE_KEY]: false });

  const settings = await getSettings();
  const reviewTabs = await listReviewTabs();

  for (const tab of reviewTabs) {
    if (!tab.id) continue;

    try {
      await sendMessageToTab(tab.id, { type: 'STOP_AUTO_MODE_FROM_POPUP' });
    } catch {
      // ignore
    }
  }

  const activeTab = await getActiveTab();

  return buildStatus({
    available: reviewTabs.length > 0,
    pageUrl: activeTab?.url ?? reviewTabs[0]?.url ?? null,
    requested: false,
    running: false,
    extensionEnabled: settings.enabled,
    statusText: 'Автоответ остановлен.'
  });
}
