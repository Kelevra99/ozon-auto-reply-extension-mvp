// src/api.ts
function ensureSettings(settings) {
  if (!settings.apiKey) {
    throw new Error("\u0423\u043A\u0430\u0436\u0438\u0442\u0435 API-\u043A\u043B\u044E\u0447, \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u043D\u044B\u0439 \u043D\u0430 \u0441\u0430\u0439\u0442\u0435 kairox.su.");
  }
}
function getBaseUrl(settings) {
  return settings.backendBaseUrl.replace(/\/+$/, "");
}
function debugLog(stage, payload) {
  console.info(`[Kairox OZON Auto Reply] ${stage}`, payload);
}
async function parseError(response) {
  try {
    const data = await response.json();
    return data?.message || data?.error || JSON.stringify(data);
  } catch {
    return `${response.status} ${response.statusText}`.trim();
  }
}
async function postJson(url, options) {
  const headers = {
    "Content-Type": "application/json"
  };
  if (options.apiKey) {
    headers.Authorization = `Bearer ${options.apiKey}`;
  }
  debugLog("request", {
    url,
    body: options.body,
    hasApiKey: Boolean(options.apiKey)
  });
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(options.body)
  });
  if (!response.ok) {
    const errorText = await parseError(response);
    debugLog("response:error", {
      url,
      status: response.status,
      error: errorText
    });
    throw new Error(errorText);
  }
  const data = await response.json();
  debugLog("response:ok", {
    url,
    data
  });
  return data;
}
async function checkConnection(settings) {
  ensureSettings(settings);
  const baseUrl = getBaseUrl(settings);
  return postJson(`${baseUrl}/v1/extension/auth/check`, {
    apiKey: settings.apiKey,
    body: {}
  });
}
async function generateReply(settings, payload) {
  ensureSettings(settings);
  const baseUrl = getBaseUrl(settings);
  return postJson(`${baseUrl}/v1/replies/generate`, {
    apiKey: settings.apiKey,
    body: payload
  });
}
async function reportReplyResult(settings, payload) {
  const baseUrl = getBaseUrl(settings);
  return postJson(`${baseUrl}/v1/replies/result`, {
    apiKey: settings.apiKey || void 0,
    body: payload
  });
}

// src/storage.ts
var BACKEND_BASE_URL = "https://api.sellerreply.ru";
var DEFAULT_SETTINGS = {
  backendBaseUrl: BACKEND_BASE_URL,
  apiKey: "",
  mode: "expert",
  enabled: true
};
function normalizeBaseUrl(_value) {
  return BACKEND_BASE_URL;
}
function normalizeMode(value) {
  if (value === "standard" || value === "advanced" || value === "expert") {
    return value;
  }
  return DEFAULT_SETTINGS.mode;
}
function normalizeEnabled(value) {
  if (typeof value === "boolean") {
    return value;
  }
  return DEFAULT_SETTINGS.enabled;
}
async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  return {
    backendBaseUrl: normalizeBaseUrl(stored.backendBaseUrl),
    apiKey: typeof stored.apiKey === "string" ? stored.apiKey.trim() : "",
    mode: normalizeMode(stored.mode),
    enabled: normalizeEnabled(stored.enabled)
  };
}
async function saveSettings(settings) {
  const current = await getSettings();
  const next = {
    backendBaseUrl: BACKEND_BASE_URL,
    apiKey: typeof settings.apiKey === "string" ? settings.apiKey.trim() : current.apiKey,
    mode: normalizeMode(settings.mode ?? current.mode),
    enabled: normalizeEnabled(settings.enabled ?? current.enabled)
  };
  await chrome.storage.local.set(next);
  return next;
}

// src/background.ts
var REVIEWS_URL = "https://seller.ozon.ru/app/reviews";
var AUTO_MODE_STORAGE_KEY = "fineroxAutoReplyEnabled";
chrome.runtime.onInstalled.addListener(async () => {
  await saveSettings({});
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void handleMessage(message).then((response) => sendResponse(response)).catch((error) => {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : "\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430\u044F \u043E\u0448\u0438\u0431\u043A\u0430"
    });
  });
  return true;
});
async function handleMessage(message) {
  switch (message?.type) {
    case "GET_SETTINGS": {
      const settings = await getSettings();
      return { ok: true, data: settings };
    }
    case "SAVE_SETTINGS": {
      const settings = await saveSettings(message.payload ?? {});
      return { ok: true, data: settings };
    }
    case "CHECK_CONNECTION": {
      const settings = await getSettings();
      const data = await checkConnection(settings);
      return { ok: true, data };
    }
    case "GENERATE_REPLY": {
      const settings = await getSettings();
      const data = await generateReply(settings, message.payload);
      return { ok: true, data };
    }
    case "REPORT_RESULT": {
      const settings = await getSettings();
      const data = await reportReplyResult(settings, message.payload);
      return { ok: true, data };
    }
    case "GET_AUTO_MODE_STATUS": {
      const data = await getAutoModeStatus();
      return { ok: true, data };
    }
    case "POPUP_SET_AUTO_MODE": {
      const enabled = Boolean(message?.payload?.enabled);
      const data = enabled ? await startAutoModeFromPopup() : await stopAutoModeFromPopup();
      return { ok: true, data };
    }
    default:
      return { ok: false, error: "\u041D\u0435\u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u043C\u044B\u0439 \u0442\u0438\u043F \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F" };
  }
}
function wait(ms) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
function isReviewsUrl(url) {
  return typeof url === "string" && url.startsWith(REVIEWS_URL);
}
function buildStatus(overrides = {}) {
  return {
    available: false,
    pageUrl: null,
    requested: false,
    running: false,
    extensionEnabled: true,
    statusText: "\u0410\u0432\u0442\u043E\u043E\u0442\u0432\u0435\u0442 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D.",
    statusTone: "default",
    ...overrides
  };
}
async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] ?? null;
}
async function listReviewTabs() {
  return chrome.tabs.query({
    url: [
      "https://seller.ozon.ru/app/reviews*",
      "https://*.seller.ozon.ru/app/reviews*",
      "https://*.ozon.ru/app/reviews*"
    ]
  });
}
async function getPreferredReviewTab(activeTab) {
  const currentActive = activeTab ?? await getActiveTab();
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
async function waitForTabComplete(tabId, timeoutMs = 3e4) {
  const existing = await chrome.tabs.get(tabId);
  if (existing.status === "complete") return;
  await new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      cleanup();
      reject(new Error("\u0421\u0442\u0440\u0430\u043D\u0438\u0446\u0430 OZON \u043D\u0435 \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u043B\u0430\u0441\u044C \u0432\u043E\u0432\u0440\u0435\u043C\u044F"));
    }, timeoutMs);
    const onUpdated = (updatedTabId, changeInfo) => {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === "complete") {
        cleanup();
        resolve();
      }
    };
    const onRemoved = (removedTabId) => {
      if (removedTabId !== tabId) return;
      cleanup();
      reject(new Error("\u0412\u043A\u043B\u0430\u0434\u043A\u0430 OZON \u0431\u044B\u043B\u0430 \u0437\u0430\u043A\u0440\u044B\u0442\u0430"));
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
async function sendMessageToTab(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}
async function getAutoModeStatus() {
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
    const response = await sendMessageToTab(reviewTab.id, { type: "GET_AUTO_MODE_STATUS" });
    if (response?.ok && response.data) {
      return {
        ...fallback,
        ...response.data,
        available: true,
        pageUrl: response.data.pageUrl ?? reviewTab.url ?? fallback.pageUrl
      };
    }
  } catch {
  }
  return {
    ...fallback,
    available: true,
    pageUrl: reviewTab.url ?? fallback.pageUrl
  };
}
async function startAutoModeFromPopup() {
  const settings = await getSettings();
  if (!settings.apiKey) {
    throw new Error("\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0432\u0432\u0435\u0434\u0438\u0442\u0435 API-\u043A\u043B\u044E\u0447, \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u043D\u044B\u0439 \u043D\u0430 \u0441\u0430\u0439\u0442\u0435 kairox.su.");
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
      statusText: "\u0417\u0430\u043F\u0443\u0441\u043A\u0430\u044E \u0430\u0432\u0442\u043E\u043E\u0442\u0432\u0435\u0442..."
    });
  }
  await waitForTabComplete(activeTab.id);
  await wait(700);
  try {
    await sendMessageToTab(activeTab.id, { type: "START_AUTO_MODE_FROM_POPUP" });
  } catch {
    await wait(1200);
    try {
      await sendMessageToTab(activeTab.id, { type: "START_AUTO_MODE_FROM_POPUP" });
    } catch {
    }
  }
  const refreshedTab = await chrome.tabs.get(activeTab.id);
  return buildStatus({
    available: true,
    pageUrl: refreshedTab.url ?? REVIEWS_URL,
    requested: true,
    running: true,
    extensionEnabled: true,
    statusText: "\u0417\u0430\u043F\u0443\u0441\u043A\u0430\u044E \u0430\u0432\u0442\u043E\u043E\u0442\u0432\u0435\u0442..."
  });
}
async function stopAutoModeFromPopup() {
  await chrome.storage.local.set({ [AUTO_MODE_STORAGE_KEY]: false });
  const settings = await getSettings();
  const reviewTabs = await listReviewTabs();
  for (const tab of reviewTabs) {
    if (!tab.id) continue;
    try {
      await sendMessageToTab(tab.id, { type: "STOP_AUTO_MODE_FROM_POPUP" });
    } catch {
    }
  }
  const activeTab = await getActiveTab();
  return buildStatus({
    available: reviewTabs.length > 0,
    pageUrl: activeTab?.url ?? reviewTabs[0]?.url ?? null,
    requested: false,
    running: false,
    extensionEnabled: settings.enabled,
    statusText: "\u0410\u0432\u0442\u043E\u043E\u0442\u0432\u0435\u0442 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D."
  });
}
//# sourceMappingURL=background.js.map
