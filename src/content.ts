import {
  extractReview,
  findReplyInput,
  findReviewCards,
  getReviewSignature,
  insertReplyIntoInput,
  isReviewPage,
  mountUiRoot
} from './dom';
import type {
  BackgroundRequest,
  BackgroundResponse,
  ExtractedReview,
  ExtensionSettings,
  GenerateReplyResponse,
  ReplyResultPayload
} from './types';

const scanDebounceMs = 180;
const HIDDEN_NATIVE_AI_ATTR = 'data-ozon-auto-reply-hidden';

let scanTimer: number | null = null;
let extensionEnabled = true;
let observer: MutationObserver | null = null;

const processedCards = new WeakMap<HTMLElement, string>();

async function sendMessage<T>(message: BackgroundRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as BackgroundResponse<T>;
  if (!response?.ok) {
    throw new Error(response?.error || 'Ошибка расширения');
  }
  return response.data as T;
}

function cleanupInjectedUi() {
  if (scanTimer !== null) {
    window.clearTimeout(scanTimer);
    scanTimer = null;
  }

  document.querySelectorAll<HTMLElement>('.ozon-auto-reply-root').forEach((root) => {
    root.remove();
  });

  document
    .querySelectorAll<HTMLElement>(`[${HIDDEN_NATIVE_AI_ATTR}="true"]`)
    .forEach((element) => {
      element.style.display = '';
      element.style.visibility = '';
      element.style.pointerEvents = '';
      element.style.height = '';
      element.style.minHeight = '';
      element.style.margin = '';
      element.style.padding = '';
      element.style.overflow = '';
      element.removeAttribute(HIDDEN_NATIVE_AI_ATTR);
    });
}

function applyEnabledState(enabled: boolean) {
  extensionEnabled = enabled;

  if (!enabled) {
    cleanupInjectedUi();
    return;
  }

  if (isReviewPage()) {
    scheduleScan();
    window.setTimeout(() => scheduleScan(), 80);
    window.setTimeout(() => scheduleScan(), 260);
  }
}

function scheduleScan() {
  if (!extensionEnabled) return;

  if (scanTimer !== null) {
    window.clearTimeout(scanTimer);
  }

  scanTimer = window.setTimeout(() => {
    scanTimer = null;
    void bindCards();
  }, scanDebounceMs);
}

function updateStatus(
  root: HTMLElement,
  text: string,
  tone: 'default' | 'success' | 'error' | 'warn' = 'default'
) {
  const status = root.querySelector<HTMLElement>('[data-role="status"]');
  if (!status) return;
  status.textContent = text;
  status.className = 'ozon-auto-reply-status';
  if (tone !== 'default') status.classList.add(tone);
}

function updateMeta(root: HTMLElement, metaText: string) {
  const meta = root.querySelector<HTMLElement>('[data-role="meta"]');
  if (meta) meta.textContent = metaText;
}

function setBusy(root: HTMLElement, busy: boolean) {
  root.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    button.disabled = busy;
  });
}

async function reportResult(payload: ReplyResultPayload) {
  try {
    await sendMessage<unknown>({ type: 'REPORT_RESULT', payload });
  } catch (error) {
    console.warn('[OZON Auto Reply] Failed to report result', error);
  }
}

async function generateAndInsertForCard(card: HTMLElement, root: HTMLElement): Promise<void> {
  if (!extensionEnabled) {
    updateStatus(root, 'Расширение выключено', 'warn');
    return;
  }

  let review: ExtractedReview | null = null;

  try {
    setBusy(root, true);
    root.dataset.processing = 'true';
    updateStatus(root, 'Извлечение данных...');
    updateMeta(root, '');

    review = await extractReview(card);

    updateStatus(root, 'Генерация ответа...');
    const settings = await sendMessage<ExtensionSettings>({ type: 'GET_SETTINGS' });

    const result = await sendMessage<GenerateReplyResponse>({
      type: 'GENERATE_REPLY',
      payload: {
        ...review,
        marketplace: 'ozon',
        mode: settings.mode
      }
    });

    root.dataset.reviewExternalId = review.reviewExternalId;
    root.dataset.reviewLogId = result.reviewLogId;
    root.dataset.generatedReply = result.generatedReply;

    if (!extensionEnabled) {
      updateStatus(root, 'Расширение выключено', 'warn');
      updateMeta(root, '');

      await reportResult({
        reviewLogId: result.reviewLogId,
        status: 'skipped',
        errorText: 'Extension disabled before insert'
      });

      return;
    }

    updateStatus(root, 'Вставка ответа...');
    const input = findReplyInput(card);
    if (!input) {
      throw new Error('Не найдено поле ответа');
    }

    insertReplyIntoInput(input, result.generatedReply);

    updateStatus(root, 'Ответ вставлен', 'success');
    updateMeta(root, '');

    await reportResult({
      reviewLogId: result.reviewLogId,
      status: 'inserted',
      finalReply: result.generatedReply
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Не удалось обработать отзыв';
    updateStatus(root, message, 'error');
    updateMeta(root, '');

    if (root.dataset.reviewLogId) {
      await reportResult({
        reviewLogId: root.dataset.reviewLogId,
        status: 'failed',
        errorText: message
      });
    }
  } finally {
    root.dataset.processing = 'false';
    setBusy(root, false);
  }
}

function bindCard(card: HTMLElement) {
  if (!extensionEnabled) return;

  const signature = getReviewSignature(card);
  const root = mountUiRoot(card, signature);
  const generateButton = root.querySelector<HTMLButtonElement>('[data-role="generate"]');

  if (!generateButton) return;

  processedCards.set(card, signature);
  root.dataset.reviewSignature = signature;

  generateButton.onclick = async (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (!extensionEnabled) {
      updateStatus(root, 'Расширение выключено', 'warn');
      return;
    }

    if (root.dataset.processing === 'true' || generateButton.dataset.busy === 'true') {
      return;
    }

    generateButton.dataset.busy = 'true';
    generateButton.disabled = true;

    try {
      await generateAndInsertForCard(card, root);
    } catch (error) {
      console.error('[OZON Auto Reply] generate click failed', error);
    } finally {
      generateButton.dataset.busy = 'false';
      generateButton.disabled = false;
    }
  };
}

async function bindCards() {
  if (!extensionEnabled) return;
  if (!isReviewPage()) return;

  const cards = findReviewCards();

  for (const card of cards) {
    const signature = getReviewSignature(card);
    const previousSignature = processedCards.get(card);
    const currentRoot = card.querySelector<HTMLElement>('.ozon-auto-reply-root');
    const currentRootSignature = currentRoot?.dataset.reviewSignature;

    if (previousSignature === signature && currentRoot && currentRootSignature === signature) {
      continue;
    }

    bindCard(card);
  }
}

function initObserver() {
  if (observer) return;

  observer = new MutationObserver((mutations) => {
    if (!extensionEnabled) return;

    const shouldScan = mutations.some(
      (mutation) => mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0
    );

    if (shouldScan) {
      scheduleScan();
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  document.addEventListener(
    'click',
    () => {
      if (!extensionEnabled) return;
      window.setTimeout(() => scheduleScan(), 80);
      window.setTimeout(() => scheduleScan(), 260);
      window.setTimeout(() => scheduleScan(), 800);
    },
    true
  );

  document.addEventListener(
    'keyup',
    () => {
      if (!extensionEnabled) return;
      window.setTimeout(() => scheduleScan(), 120);
    },
    true
  );
}

async function init() {
  initObserver();

  try {
    const settings = await sendMessage<ExtensionSettings>({ type: 'GET_SETTINGS' });
    applyEnabledState(settings.enabled);
  } catch (error) {
    console.warn('[OZON Auto Reply] Failed to load settings, extension enabled by default', error);
    applyEnabledState(true);
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (!Object.prototype.hasOwnProperty.call(changes, 'enabled')) return;

  const nextValue = changes.enabled?.newValue;
  applyEnabledState(typeof nextValue === 'boolean' ? nextValue : true);
});

void init();
