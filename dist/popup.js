// src/storage.ts
var BACKEND_BASE_URL = "https://api.sellerreply.ru";
var DEFAULT_SETTINGS = {
  backendBaseUrl: BACKEND_BASE_URL,
  apiKey: "",
  mode: "expert",
  enabled: true
};

// src/popup.ts
var enabledInput = document.getElementById("enabled");
var enabledStateLabel = document.getElementById("enabledStateLabel");
var apiKeyInput = document.getElementById("apiKey");
var modeSelect = document.getElementById("mode");
var saveButton = document.getElementById("saveButton");
var checkButton = document.getElementById("checkButton");
var autoStartButton = document.getElementById("autoStartButton");
var closeButton = document.getElementById("closeButton");
var statusBox = document.getElementById("status");
var currentEnabled = true;
var currentBusy = false;
var currentAutoActive = false;
var autoPollTimer = null;
async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) {
    throw new Error(response?.error || "\u041E\u0448\u0438\u0431\u043A\u0430 \u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u044F");
  }
  return response.data;
}
function setStatus(text, tone = "default") {
  statusBox.textContent = text;
  statusBox.className = "status";
  if (tone !== "default") statusBox.classList.add(tone);
}
function updateEnabledLabel(enabled) {
  enabledStateLabel.textContent = enabled ? "\u0412\u043A\u043B\u044E\u0447\u0435\u043D\u043E" : "\u0412\u044B\u043A\u043B\u044E\u0447\u0435\u043D\u043E";
}
function updateAutoStartAvailability() {
  const hasApiKey = apiKeyInput.value.trim().length > 0;
  const canUse = !currentBusy && currentEnabled && (currentAutoActive || hasApiKey);
  autoStartButton.disabled = !canUse;
  if (currentAutoActive) {
    autoStartButton.className = "danger";
    return;
  }
  autoStartButton.className = canUse ? "primary" : "ghost";
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
function setBusy(busy) {
  currentBusy = busy;
  applyAvailability();
}
function humanizeError(error, fallback) {
  const message = error instanceof Error ? error.message : fallback;
  const normalized = message.toLowerCase();
  if (normalized.includes("401") || normalized.includes("403") || normalized.includes("unauthorized") || normalized.includes("forbidden") || normalized.includes("invalid") || normalized.includes("api key") || normalized.includes("api-\u043A\u043B\u044E\u0447")) {
    return "API-\u043A\u043B\u044E\u0447 \u043D\u0435 \u043F\u043E\u0434\u043E\u0448\u0451\u043B. \u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u0435\u0433\u043E \u043D\u0430 \u0441\u0430\u0439\u0442\u0435 kairox.su.";
  }
  if (normalized.includes("failed to fetch") || normalized.includes("networkerror") || normalized.includes("load failed")) {
    return "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u0432\u044F\u0437\u0430\u0442\u044C\u0441\u044F \u0441 \u0441\u0435\u0440\u0432\u0438\u0441\u043E\u043C. \u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u0438\u043D\u0442\u0435\u0440\u043D\u0435\u0442 \u0438 \u043F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0435 \u043F\u043E\u043F\u044B\u0442\u043A\u0443.";
  }
  return message || fallback;
}
function describeEnabledState(enabled) {
  return enabled ? "\u0412\u043A\u043B\u044E\u0447\u0435\u043D\u043E." : "\u0412\u044B\u043A\u043B\u044E\u0447\u0435\u043D\u043E.";
}
function applySettings(settings) {
  currentEnabled = settings.enabled;
  enabledInput.checked = settings.enabled;
  apiKeyInput.value = settings.apiKey || "";
  modeSelect.value = settings.mode || DEFAULT_SETTINGS.mode;
  applyAvailability();
}
function applyAutoModeState(state) {
  const active = Boolean(state?.requested || state?.running);
  currentAutoActive = active;
  autoStartButton.dataset.active = active ? "true" : "false";
  autoStartButton.textContent = active ? "\u041E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u0430\u0432\u0442\u043E\u043E\u0442\u0432\u0435\u0442" : "\u0417\u0430\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u0430\u0432\u0442\u043E\u043E\u0442\u0432\u0435\u0442";
  updateAutoStartAvailability();
}
async function persistSettingsWithEnabled(enabled) {
  return sendMessage({
    type: "SAVE_SETTINGS",
    payload: {
      backendBaseUrl: BACKEND_BASE_URL,
      apiKey: apiKeyInput.value,
      mode: modeSelect.value,
      enabled
    }
  });
}
async function loadSettings() {
  const settings = await sendMessage({ type: "GET_SETTINGS" });
  applySettings(settings);
  setStatus(describeEnabledState(settings.enabled));
}
async function loadAutoModeState(silent = false) {
  try {
    const state = await sendMessage({ type: "GET_AUTO_MODE_STATUS" });
    applyAutoModeState(state);
    if (!currentBusy && state?.statusText) {
      const tone = state.statusTone === "error" ? "error" : state.statusTone === "success" ? "success" : "default";
      setStatus(state.statusText, tone);
    }
  } catch (error) {
    if (!silent) {
      setStatus(humanizeError(error, "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435 \u0430\u0432\u0442\u043E\u043E\u0442\u0432\u0435\u0442\u0430."), "error");
    }
  }
}
async function saveSettings() {
  setBusy(true);
  try {
    const settings = await persistSettingsWithEnabled(enabledInput.checked);
    applySettings(settings);
    setStatus(
      settings.enabled ? "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u044B. \u0412\u043A\u043B\u044E\u0447\u0435\u043D\u043E." : "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u044B. \u0412\u044B\u043A\u043B\u044E\u0447\u0435\u043D\u043E.",
      "success"
    );
    await loadAutoModeState(true);
  } catch (error) {
    setStatus(humanizeError(error, "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438."), "error");
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
        await sendMessage({
          type: "POPUP_SET_AUTO_MODE",
          payload: { enabled: false }
        });
      } catch {
      }
      applyAutoModeState({
        available: false,
        pageUrl: null,
        requested: false,
        running: false,
        extensionEnabled: false,
        statusText: "\u0410\u0432\u0442\u043E\u043E\u0442\u0432\u0435\u0442 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D.",
        statusTone: "default"
      });
    }
    const settings = await sendMessage({
      type: "SAVE_SETTINGS",
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
        statusText: "\u0410\u0432\u0442\u043E\u043E\u0442\u0432\u0435\u0442 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D.",
        statusTone: "default"
      });
    }
    setStatus(describeEnabledState(settings.enabled), "success");
  } catch (error) {
    enabledInput.checked = !enabledInput.checked;
    setStatus(
      humanizeError(error, "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0438\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435 \u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u044F."),
      "error"
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
    const data = await sendMessage({ type: "CHECK_CONNECTION" });
    if (!data.valid) {
      throw new Error("invalid api key");
    }
    const name = data.user?.name || data.user?.email;
    if (name) {
      setStatus(`\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 \u0443\u0441\u043F\u0435\u0448\u043D\u043E. \u0410\u043A\u043A\u0430\u0443\u043D\u0442: ${name}.`, "success");
    } else {
      setStatus("\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 \u0443\u0441\u043F\u0435\u0448\u043D\u043E.", "success");
    }
  } catch (error) {
    setStatus(humanizeError(error, "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435."), "error");
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
        throw new Error("\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0432\u0432\u0435\u0434\u0438\u0442\u0435 API-\u043A\u043B\u044E\u0447, \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u043D\u044B\u0439 \u043D\u0430 \u0441\u0430\u0439\u0442\u0435 kairox.su.");
      }
    }
    const state = await sendMessage({
      type: "POPUP_SET_AUTO_MODE",
      payload: { enabled: shouldEnable }
    });
    applyAutoModeState(state);
    await loadSettings();
    await loadAutoModeState(true);
    setStatus(
      shouldEnable ? "\u0410\u0432\u0442\u043E\u043E\u0442\u0432\u0435\u0442 \u0437\u0430\u043F\u0443\u0441\u043A\u0430\u0435\u0442\u0441\u044F..." : "\u0410\u0432\u0442\u043E\u043E\u0442\u0432\u0435\u0442 \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D.",
      "success"
    );
  } catch (error) {
    setStatus(
      humanizeError(error, "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0438\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435 \u0430\u0432\u0442\u043E\u043E\u0442\u0432\u0435\u0442\u0430."),
      "error"
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
enabledInput.addEventListener("change", () => {
  void saveEnabledState();
});
apiKeyInput.addEventListener("input", () => {
  updateAutoStartAvailability();
});
saveButton.addEventListener("click", () => {
  void saveSettings();
});
checkButton.addEventListener("click", () => {
  void checkConnection();
});
autoStartButton.addEventListener("click", () => {
  void toggleAutoMode();
});
closeButton?.addEventListener("click", () => {
  window.close();
});
void (async () => {
  try {
    await loadSettings();
    await loadAutoModeState(true);
    startAutoPolling();
  } catch (error) {
    setStatus(
      humanizeError(error, "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u044F."),
      "error"
    );
  }
})();
//# sourceMappingURL=popup.js.map
