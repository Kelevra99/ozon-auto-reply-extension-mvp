from pathlib import Path
import re
import sys

path = Path("src/content.ts")
text = path.read_text(encoding="utf-8")

if "START_AUTO_MODE_FROM_POPUP" in text and "GET_AUTO_MODE_STATUS" in text:
    print("content.ts already patched")
    sys.exit(0)

marker = "async function init() {"
if marker not in text:
    print("Не найден marker async function init()", file=sys.stderr)
    sys.exit(1)

insert_block = """
function getAutoModeStatusSnapshot() { return { available: isReviewPage(), pageUrl: location.href, requested: autoState.enabled, running: autoState.running, extensionEnabled, statusText: autoState.statusText, statusTone: autoState.statusTone }; } chrome.runtime.onMessage.addListener((message: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => { if (!message || typeof message !== 'object') { return undefined; } if (message.type === 'GET_AUTO_MODE_STATUS') { sendResponse({ ok: true, data: getAutoModeStatusSnapshot() }); return true; } if (message.type === 'START_AUTO_MODE_FROM_POPUP') { void (async () => { try { if (!isReviewPage()) { throw new Error('Откройте страницу отзывов OZON.'); } ensureAutoControls(); if (!extensionEnabled) { await applyExtensionEnabledState(true); } await startAutoMode(); sendResponse({ ok: true, data: getAutoModeStatusSnapshot() }); } catch (error) { sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Не удалось запустить автоответ.' }); } })(); return true; } if (message.type === 'STOP_AUTO_MODE_FROM_POPUP') { void (async () => { try { if (autoState.enabled || autoState.running) { await stopAutoMode('Автоответ остановлен из расширения.'); } else { await setPersistentAutoModeEnabled(false); autoState.enabled = false; autoState.stopRequested = true; autoState.running = false; setAutoStatus('Автоответ остановлен.'); updateAutoControls(); } sendResponse({ ok: true, data: getAutoModeStatusSnapshot() }); } catch (error) { sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Не удалось остановить автоответ.' }); } })(); return true; } return undefined; }); 
"""

text = text.replace(marker, insert_block + marker, 1)

old_listener = "chrome.storage.onChanged.addListener((changes, areaName) => { if (areaName !== 'local' || !Object.prototype.hasOwnProperty.call(changes, 'enabled')) { return; } const nextValue = changes.enabled?.newValue; void applyExtensionEnabledState(typeof nextValue === 'boolean' ? nextValue : true); });"
new_listener = "chrome.storage.onChanged.addListener((changes, areaName) => { if (areaName !== 'local') { return; } if (Object.prototype.hasOwnProperty.call(changes, 'enabled')) { const nextValue = changes.enabled?.newValue; void applyExtensionEnabledState(typeof nextValue === 'boolean' ? nextValue : true); } if (!Object.prototype.hasOwnProperty.call(changes, AUTO_MODE_STORAGE_KEY)) { return; } if (!isReviewPage()) { return; } const nextAutoModeEnabled = Boolean(changes[AUTO_MODE_STORAGE_KEY]?.newValue); if (nextAutoModeEnabled) { if (extensionEnabled && !autoState.enabled && !autoState.running) { void startAutoMode(); } return; } if (autoState.enabled || autoState.running) { void stopAutoMode('Автоответ остановлен из расширения.'); return; } autoState.enabled = false; autoState.stopRequested = true; autoState.running = false; setAutoStatus('Автоответ остановлен.'); updateAutoControls(); });"

if old_listener in text:
    text = text.replace(old_listener, new_listener, 1)
else:
    pattern = r"chrome\.storage\.onChanged\.addListener\(\(changes, areaName\) => \{[\s\S]*?void applyExtensionEnabledState\(typeof nextValue === 'boolean' \? nextValue : true\);\s*\}\);"
    text, count = re.subn(pattern, new_listener, text, count=1)
    if count != 1:
        print("Не удалось заменить storage listener", file=sys.stderr)
        sys.exit(1)

path.write_text(text, encoding="utf-8")
print("src/content.ts updated")
