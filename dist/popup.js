// src/storage.ts
var DEFAULT_SETTINGS = {
  backendBaseUrl: "http://localhost:3001",
  apiKey: "",
  mode: "advanced"
};

// src/popup.ts
var backendBaseUrlInput = document.getElementById("backendBaseUrl");
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
  saveButton.disabled = busy;
  checkButton.disabled = busy;
}
async function loadSettings() {
  const settings = await sendMessage({ type: "GET_SETTINGS" });
  backendBaseUrlInput.value = settings.backendBaseUrl || DEFAULT_SETTINGS.backendBaseUrl;
  apiKeyInput.value = settings.apiKey || "";
  modeSelect.value = settings.mode || DEFAULT_SETTINGS.mode;
}
async function saveSettings() {
  setBusy(true);
  try {
    const settings = await sendMessage({
      type: "SAVE_SETTINGS",
      payload: {
        backendBaseUrl: backendBaseUrlInput.value,
        apiKey: apiKeyInput.value,
        mode: modeSelect.value
      }
    });
    backendBaseUrlInput.value = settings.backendBaseUrl;
    apiKeyInput.value = settings.apiKey;
    modeSelect.value = settings.mode;
    setStatus("\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u044B.", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438", "error");
  } finally {
    setBusy(false);
  }
}
async function checkConnection() {
  setBusy(true);
  try {
    await saveSettings();
    const data = await sendMessage({ type: "CHECK_CONNECTION" });
    if (!data.valid) {
      throw new Error("Backend \u0432\u0435\u0440\u043D\u0443\u043B valid=false");
    }
    const name = data.user?.name || data.user?.email || "\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C";
    const modes = data.limits?.mode?.join(", ") || "\u043D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D\u044B";
    setStatus(`\u0421\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u0435 \u0443\u0441\u043F\u0435\u0448\u043D\u043E. \u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C: ${name}. \u0414\u043E\u0441\u0442\u0443\u043F\u043D\u044B\u0435 \u0440\u0435\u0436\u0438\u043C\u044B: ${modes}`, "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0438 \u0441\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u044F", "error");
  } finally {
    setBusy(false);
  }
}
saveButton.addEventListener("click", () => {
  void saveSettings();
});
checkButton.addEventListener("click", () => {
  void checkConnection();
});
void loadSettings();
//# sourceMappingURL=popup.js.map
