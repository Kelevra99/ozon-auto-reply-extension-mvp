// src/storage.ts
var BACKEND_BASE_URL = "https://api.finerox.online";
var DEFAULT_SETTINGS = {
  backendBaseUrl: BACKEND_BASE_URL,
  apiKey: "",
  mode: "expert",
  enabled: true
};

// src/popup.ts
var enabledInput = document.getElementById("enabled");
var apiKeyInput = document.getElementById("apiKey");
var modeSelect = document.getElementById("mode");
var saveButton = document.getElementById("saveButton");
var checkButton = document.getElementById("checkButton");
var statusBox = document.getElementById("status");
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
function setBusy(busy) {
  enabledInput.disabled = busy;
  saveButton.disabled = busy;
  checkButton.disabled = busy;
}
function humanizeError(error, fallback) {
  const message = error instanceof Error ? error.message : fallback;
  const normalized = message.toLowerCase();
  if (normalized.includes("401") || normalized.includes("403") || normalized.includes("unauthorized") || normalized.includes("forbidden") || normalized.includes("invalid") || normalized.includes("api key") || normalized.includes("api-\u043A\u043B\u044E\u0447")) {
    return "API-\u043A\u043B\u044E\u0447 \u043D\u0435 \u043F\u043E\u0434\u043E\u0448\u0451\u043B. \u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u0435\u0433\u043E \u043D\u0430 \u0441\u0430\u0439\u0442\u0435 finerox.online.";
  }
  if (normalized.includes("failed to fetch") || normalized.includes("networkerror") || normalized.includes("load failed")) {
    return "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u0432\u044F\u0437\u0430\u0442\u044C\u0441\u044F \u0441 \u0441\u0435\u0440\u0432\u0438\u0441\u043E\u043C. \u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u0438\u043D\u0442\u0435\u0440\u043D\u0435\u0442 \u0438 \u043F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0435 \u043F\u043E\u043F\u044B\u0442\u043A\u0443.";
  }
  return message || fallback;
}
function describeEnabledState(enabled) {
  return enabled ? "\u0420\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u0435 \u0432\u043A\u043B\u044E\u0447\u0435\u043D\u043E. \u041D\u0430 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0435 OZON \u043F\u043E\u044F\u0432\u044F\u0442\u0441\u044F \u043A\u043D\u043E\u043F\u043A\u0438 Finerox." : "\u0420\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u0435 \u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D\u043E. Finerox \u043D\u0435 \u043C\u0435\u043D\u044F\u0435\u0442 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443 OZON.";
}
function applySettings(settings) {
  enabledInput.checked = settings.enabled;
  apiKeyInput.value = settings.apiKey || "";
  modeSelect.value = settings.mode || DEFAULT_SETTINGS.mode;
}
async function persistSettings() {
  return sendMessage({
    type: "SAVE_SETTINGS",
    payload: {
      backendBaseUrl: BACKEND_BASE_URL,
      apiKey: apiKeyInput.value,
      mode: modeSelect.value,
      enabled: enabledInput.checked
    }
  });
}
async function loadSettings() {
  const settings = await sendMessage({ type: "GET_SETTINGS" });
  applySettings(settings);
  setStatus(describeEnabledState(settings.enabled));
}
async function saveSettings() {
  setBusy(true);
  try {
    const settings = await persistSettings();
    applySettings(settings);
    setStatus(
      settings.enabled ? "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u044B. \u0420\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u0435 \u0432\u043A\u043B\u044E\u0447\u0435\u043D\u043E." : "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u044B. \u0420\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u0435 \u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D\u043E.",
      "success"
    );
  } catch (error) {
    setStatus(humanizeError(error, "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438."), "error");
  } finally {
    setBusy(false);
  }
}
async function saveEnabledState() {
  setBusy(true);
  try {
    const settings = await sendMessage({
      type: "SAVE_SETTINGS",
      payload: {
        enabled: enabledInput.checked
      }
    });
    applySettings(settings);
    setStatus(describeEnabledState(settings.enabled), "success");
  } catch (error) {
    enabledInput.checked = !enabledInput.checked;
    setStatus(humanizeError(error, "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0438\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435 \u0440\u0430\u0441\u0448\u0438\u0440\u0435\u043D\u0438\u044F."), "error");
  } finally {
    setBusy(false);
  }
}
async function checkConnection() {
  setBusy(true);
  try {
    const settings = await persistSettings();
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
enabledInput.addEventListener("change", () => {
  void saveEnabledState();
});
saveButton.addEventListener("click", () => {
  void saveSettings();
});
checkButton.addEventListener("click", () => {
  void checkConnection();
});
void loadSettings();
//# sourceMappingURL=popup.js.map
