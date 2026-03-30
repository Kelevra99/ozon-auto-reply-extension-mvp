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
  GenerateReplyResponse,
  ReplyResultPayload
} from './types';

const scanDebounceMs = 180;
let scanTimer: number | null = null;
const processedCards = new WeakMap<HTMLElement, string>();

function getRuntime() {
  const runtime = globalThis.chrome?.runtime;
  if (!runtime?.sendMessage) {
    throw new Error('Расширение недоступно. Обновите страницу OZON после установки или перезагрузки расширения.');
  }
  return runtime;
}

async function sendMessage<T>(message: BackgroundRequest): Promise<T> {
  const runtime = getRuntime();
  const response = (await runtime.sendMessage(message)) as BackgroundResponse<T>;

  if (!response?.ok) {
    throw new Error(response?.error || 'Ошибка расширения');
  }

  return response.data as T;
}

function scheduleScan() {
  if (scanTimer !== null) {
    window.clearTimeout(scanTimer);
  }
  scanTimer = window.setTimeout(() => {
    scanTimer = null;
    void bindCards();
  }, scanDebounceMs);
}

function updateStatus(root: HTMLElement, text: string, tone: 'default' | 'success' | 'error' | 'warn' = 'default') {
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
  let review: ExtractedReview | null = null;

  try {
    setBusy(root, true);
    root.dataset.processing = 'true';
    updateStatus(root, 'Извлечение данных...');
    updateMeta(root, '');

    review = await extractReview(card);

    updateStatus(root, 'Генерация ответа...');
    const settings = await sendMessage<{ backendBaseUrl: string; apiKey: string; mode: 'standard' | 'advanced' | 'expert' }>({ type: 'GET_SETTINGS' });

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
  const signature = getReviewSignature(card);
  const root = mountUiRoot(card, signature);
  const generateButton = root.querySelector<HTMLButtonElement>('[data-role="generate"]');

  if (!generateButton) return;

  processedCards.set(card, signature);
  root.dataset.reviewSignature = signature;

if (root.dataset.handlersBound !== 'true') {
  generateButton.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();

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
  });

  root.dataset.handlersBound = 'true';
}
}

async function bindCards() {
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
  const observer = new MutationObserver((mutations) => {
    const shouldScan = mutations.some((mutation) => mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0);
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
      window.setTimeout(() => scheduleScan(), 80);
      window.setTimeout(() => scheduleScan(), 260);
      window.setTimeout(() => scheduleScan(), 800);
    },
    true
  );

  document.addEventListener(
    'keyup',
    () => {
      window.setTimeout(() => scheduleScan(), 120);
    },
    true
  );
}

void bindCards();
window.setTimeout(() => void bindCards(), 300);
window.setTimeout(() => void bindCards(), 1000);
initObserver();
