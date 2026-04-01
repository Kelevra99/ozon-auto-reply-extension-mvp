from pathlib import Path
import sys

path = Path("src/popup.ts")
text = path.read_text(encoding="utf-8")

old_decl = """const autoStartButton = document.getElementById('autoStartButton') as HTMLButtonElement;
const statusBox = document.getElementById('status') as HTMLDivElement;
"""
new_decl = """const autoStartButton = document.getElementById('autoStartButton') as HTMLButtonElement;
const closeButton = document.getElementById('closeButton') as HTMLButtonElement | null;
const statusBox = document.getElementById('status') as HTMLDivElement;
"""
if old_decl in text and "closeButton" not in text:
    text = text.replace(old_decl, new_decl, 1)

old_load = """async function loadAutoModeState(silent = false) {
  try {
    const state = await sendMessage<AutoModeStatus>({ type: 'GET_AUTO_MODE_STATUS' });
    applyAutoModeState(state);
  } catch (error) {
    if (!silent) {
      setStatus(humanizeError(error, 'Не удалось получить состояние автоответа.'), 'error');
    }
  }
}
"""
new_load = """async function loadAutoModeState(silent = false) {
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
"""
if old_load in text:
    text = text.replace(old_load, new_load, 1)
else:
    print("Не найден блок loadAutoModeState в popup.ts", file=sys.stderr)
    sys.exit(1)

marker = """autoStartButton.addEventListener('click', () => {
  void toggleAutoMode();
});

void (async () => {
"""
insert = """autoStartButton.addEventListener('click', () => {
  void toggleAutoMode();
});

closeButton?.addEventListener('click', () => {
  window.close();
});

void (async () => {
"""
if marker in text and "window.close();" not in text:
    text = text.replace(marker, insert, 1)

path.write_text(text, encoding="utf-8")
print("src/popup.ts updated")
