// src/api.ts
function ensureSettings(settings) {
  if (!settings.apiKey) {
    throw new Error("\u0423\u043A\u0430\u0436\u0438\u0442\u0435 API-\u043A\u043B\u044E\u0447, \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u043D\u044B\u0439 \u043D\u0430 \u0441\u0430\u0439\u0442\u0435 finerox.online.");
  }
}
function getBaseUrl(settings) {
  return settings.backendBaseUrl.replace(/\/+$/, "");
}
function debugLog(stage, payload) {
  console.info(`[Finerox OZON Auto Reply] ${stage}`, payload);
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
var BACKEND_BASE_URL = "https://api.kairox.su";
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
chrome.runtime.onInstalled.addListener(async () => {
  await saveSettings({});
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void handleMessage(message).then((response) => sendResponse(response)).catch((error) => {
    const response = {
      ok: false,
      error: error instanceof Error ? error.message : "\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430\u044F \u043E\u0448\u0438\u0431\u043A\u0430"
    };
    sendResponse(response);
  });
  return true;
});
async function handleMessage(message) {
  switch (message.type) {
    case "GET_SETTINGS": {
      const settings = await getSettings();
      return { ok: true, data: settings };
    }
    case "SAVE_SETTINGS": {
      const settings = await saveSettings(message.payload);
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
    default:
      return { ok: false, error: "\u041D\u0435\u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u043C\u044B\u0439 \u0442\u0438\u043F \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F" };
  }
}
//# sourceMappingURL=background.js.map
