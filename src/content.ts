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

const AUTO_MODE_STORAGE_KEY = 'fineroxAutoReplyEnabled';
const AUTO_ROOT_ID = 'finerox-auto-runner';
const AUTO_STYLES_ID = 'finerox-auto-runner-styles';

type ReviewRowCandidate = {
  row: HTMLElement;
  clickTarget: HTMLElement;
  title: string;
  status: 'Новый' | 'Просмотрен';
};

const triedTitlesInCycle = new Set<string>();

const autoState = {
  enabled: false,
  running: false,
  stopRequested: false,
  batchTarget: randomInt(10, 15),
  processedInBatch: 0,
  totalProcessed: 0,
  refreshedWithoutWork: false,
  statusText: 'Автоответ выключен.',
  statusTone: 'default' as 'default' | 'success' | 'error' | 'warn'
};

function getRuntime() {
  const runtime = globalThis.chrome?.runtime;
  if (!runtime?.sendMessage) {
    throw new Error('Расширение недоступно. Обновите страницу OZON после перезагрузки расширения.');
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

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function truncate(value: string, max = 60): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function randomInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function sleepRange(minMs: number, maxMs: number): Promise<void> {
  await sleep(randomInt(minMs, maxMs));
}

async function waitUntil(check: () => boolean, timeoutMs = 5000, intervalMs = 120): Promise<boolean> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (check()) return true;
    await sleep(intervalMs);
  }

  return false;
}

function isElementVisible(element: HTMLElement | null | undefined): element is HTMLElement {
  if (!element) return false;

  const style = window.getComputedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function scheduleScan() {
  if (scanTimer !== null) {
    window.clearTimeout(scanTimer);
  }
  scanTimer = window.setTimeout(() => {
    scanTimer = null;
    void bindCards();
    ensureAutoControls();
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
    console.warn('[Finerox Auto Reply] Failed to report result', error);
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
    const settings = await sendMessage<{ backendBaseUrl: string; apiKey: string; mode: 'standard' | 'advanced' | 'expert' }>({
      type: 'GET_SETTINGS'
    });

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

    throw error;
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
        console.error('[Finerox Auto Reply] generate click failed', error);
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

function setAutoStatus(
  text: string,
  tone: 'default' | 'success' | 'error' | 'warn' = 'default'
) {
  autoState.statusText = text;
  autoState.statusTone = tone;
  updateAutoControls();
}

async function getPersistentAutoModeEnabled(): Promise<boolean> {
  const data = await chrome.storage.local.get(AUTO_MODE_STORAGE_KEY);
  return Boolean(data[AUTO_MODE_STORAGE_KEY]);
}

async function setPersistentAutoModeEnabled(value: boolean): Promise<void> {
  await chrome.storage.local.set({ [AUTO_MODE_STORAGE_KEY]: value });
}

function ensureAutoStyles() {
  if (document.getElementById(AUTO_STYLES_ID)) return;

  const style = document.createElement('style');
  style.id = AUTO_STYLES_ID;
  style.textContent = `
    #${AUTO_ROOT_ID} {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-left: 12px;
      flex-wrap: wrap;
    }

    .finerox-auto-btn {
      border: 0;
      border-radius: 12px;
      padding: 10px 14px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      background: #005bff;
      color: #fff;
      white-space: nowrap;
    }

    .finerox-auto-btn.stop {
      background: #c62828;
    }

    .finerox-auto-status {
      font-size: 13px;
      line-height: 1.35;
      color: #5b6575;
      max-width: 520px;
    }

    .finerox-auto-status.success {
      color: #047857;
    }

    .finerox-auto-status.error {
      color: #b91c1c;
    }

    .finerox-auto-status.warn {
      color: #b45309;
    }
  `;
  document.head.appendChild(style);
}

function findHeaderMount(): HTMLElement | null {
  const byId = document.getElementById('download-report-ai') as HTMLButtonElement | null;
  if (byId) {
    return (byId.closest('.cs580-a5') as HTMLElement | null) ?? byId.parentElement?.parentElement?.parentElement ?? null;
  }

  const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
    (element) => normalizeText(element.innerText) === 'Скачать отчёт' || normalizeText(element.innerText) === 'Скачать отчет'
  );

  if (!button) return null;

  return (button.closest('.cs580-a5') as HTMLElement | null) ?? button.parentElement?.parentElement?.parentElement ?? null;
}

function ensureAutoControls() {
  if (!isReviewPage()) return;

  ensureAutoStyles();

  const mount = findHeaderMount();
  if (!mount) return;

  let root = document.getElementById(AUTO_ROOT_ID) as HTMLDivElement | null;

  if (!root) {
    root = document.createElement('div');
    root.id = AUTO_ROOT_ID;
    root.innerHTML = `
      <button type="button" class="finerox-auto-btn" data-role="toggle">Запустить автоответ</button>
      <div class="finerox-auto-status" data-role="status">Автоответ выключен.</div>
    `;

    const toggleButton = root.querySelector<HTMLButtonElement>('[data-role="toggle"]');
    toggleButton?.addEventListener('click', () => {
      if (autoState.enabled) {
        void stopAutoMode('Автоответ остановлен вручную.');
      } else {
        void startAutoMode();
      }
    });
  }

  if (root.parentElement !== mount) {
    mount.append(root);
  }

  updateAutoControls();
}

function updateAutoControls() {
  const root = document.getElementById(AUTO_ROOT_ID);
  if (!root) return;

  const toggleButton = root.querySelector<HTMLButtonElement>('[data-role="toggle"]');
  const status = root.querySelector<HTMLDivElement>('[data-role="status"]');

  if (toggleButton) {
    toggleButton.textContent = autoState.enabled ? 'Остановить автоответ' : 'Запустить автоответ';
    toggleButton.classList.toggle('stop', autoState.enabled);
  }

  if (status) {
    status.textContent = autoState.statusText;
    status.className = 'finerox-auto-status';
    if (autoState.statusTone !== 'default') {
      status.classList.add(autoState.statusTone);
    }
  }
}

function findWaitingFilterButton(): HTMLButtonElement | null {
  return (
    document.querySelector<HTMLButtonElement>('button[data-active="true"] span.s3c80-b5')?.closest('button') ??
    Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => normalizeText(button.innerText) === 'Ждут ответа'
    ) ??
    null
  );
}

function isWaitingFilterActive(button: HTMLButtonElement | null): boolean {
  return button?.dataset.active === 'true';
}

async function clickElement(element: HTMLElement) {
  element.scrollIntoView({ block: 'center', behavior: 'smooth' });
  await sleepRange(180, 420);
  element.click();
}

async function ensureWaitingFilterActive() {
  const filterButton = findWaitingFilterButton();
  if (!filterButton) {
    throw new Error('Не найдена кнопка "Ждут ответа"');
  }

  if (isWaitingFilterActive(filterButton)) {
    return;
  }

  setAutoStatus('Включаю фильтр "Ждут ответа"...');
  await clickElement(filterButton);

  const activated = await waitUntil(() => {
    const current = findWaitingFilterButton();
    return Boolean(current && isWaitingFilterActive(current));
  }, 7000, 140);

  if (!activated) {
    throw new Error('Не удалось включить фильтр "Ждут ответа"');
  }

  await sleepRange(700, 1300);
}

async function refreshWaitingFilter() {
  const filterButton = findWaitingFilterButton();
  if (!filterButton) {
    throw new Error('Не найдена кнопка "Ждут ответа"');
  }

  setAutoStatus('Обновляю список отзывов...');

  if (isWaitingFilterActive(filterButton)) {
    await clickElement(filterButton);

    await waitUntil(() => {
      const current = findWaitingFilterButton();
      return Boolean(current && !isWaitingFilterActive(current));
    }, 5000, 140);

    await sleepRange(700, 1300);
  }

  const nextFilterButton = findWaitingFilterButton();
  if (!nextFilterButton) {
    throw new Error('Не удалось повторно найти кнопку "Ждут ответа"');
  }

  await clickElement(nextFilterButton);

  const activated = await waitUntil(() => {
    const current = findWaitingFilterButton();
    return Boolean(current && isWaitingFilterActive(current));
  }, 7000, 140);

  if (!activated) {
    throw new Error('Не удалось повторно включить фильтр "Ждут ответа"');
  }

  triedTitlesInCycle.clear();
  autoState.processedInBatch = 0;
  autoState.batchTarget = randomInt(10, 15);
  autoState.refreshedWithoutWork = false;

  await sleepRange(1200, 2200);
}

function getRowStatus(row: HTMLElement): 'Новый' | 'Просмотрен' | 'Обработан' | null {
  const text = normalizeText(row.innerText);

  if (text.includes('Обработан')) return 'Обработан';
  if (text.includes('Просмотрен')) return 'Просмотрен';
  if (text.includes('Новый')) return 'Новый';

  return null;
}

function findCandidateRowRoot(titleNode: HTMLElement): HTMLElement | null {
  const directRow = titleNode.closest('tr') as HTMLElement | null;
  if (directRow) return directRow;

  let current = titleNode.parentElement as HTMLElement | null;
  while (current && current !== document.body) {
    const text = normalizeText(current.innerText);
    if (text.includes('Новый') || text.includes('Просмотрен') || text.includes('Обработан')) {
      return current;
    }
    current = current.parentElement;
  }

  return null;
}

function getVisiblePendingCandidates(): ReviewRowCandidate[] {
  const titleNodes = Array.from(document.querySelectorAll<HTMLElement>('div.n1d-ba8[title]')).filter(isElementVisible);
  const usedRows = new Set<HTMLElement>();
  const candidates: ReviewRowCandidate[] = [];

  for (const titleNode of titleNodes) {
    const row = findCandidateRowRoot(titleNode);
    if (!row || usedRows.has(row)) continue;

    const status = getRowStatus(row);
    if (status !== 'Новый' && status !== 'Просмотрен') continue;

    const title = normalizeText(titleNode.getAttribute('title') || titleNode.textContent);
    if (!title) continue;

    const clickTarget = (titleNode.closest('.n1d-b8a') as HTMLElement | null) ?? titleNode;
    if (!isElementVisible(clickTarget)) continue;

    usedRows.add(row);
    candidates.push({ row, clickTarget, title, status });
  }

  return candidates;
}

function pickNextCandidate(): ReviewRowCandidate | null {
  const candidates = getVisiblePendingCandidates().filter((candidate) => !triedTitlesInCycle.has(candidate.title));
  return candidates[0] ?? null;
}

function getOpenReviewModal(): HTMLElement | null {
  const cards = findReviewCards();
  return cards[0] ?? null;
}

function hasModalOpen(): boolean {
  return Boolean(getOpenReviewModal());
}

function isModalFullyLoaded(modal: HTMLElement): boolean {
  const reviewText = normalizeText(extractCommentTextFromModal(modal));
  const input = findReplyInput(modal);
  return Boolean(reviewText && input);
}

function extractCommentTextFromModal(modal: HTMLElement): string | null {
  const rows = Array.from(modal.querySelectorAll<HTMLElement>('.n1d-l7'));

  for (const row of rows) {
    const text = normalizeText(row.innerText);
    if (!text.includes('Комментарий')) continue;

    const body = row.querySelector<HTMLElement>('.n1d-m');
    const value = normalizeText(body?.innerText ?? '');
    const cleaned = value.replace(/^Комментарий\s*/i, '').trim();

    if (cleaned) return cleaned;
  }

  const raw = normalizeText(modal.innerText);
  const match = raw.match(/Комментарий\s+(.+?)\s+Оценки/si);
  return normalizeText(match?.[1] ?? null) || null;
}

async function openCandidate(candidate: ReviewRowCandidate): Promise<HTMLElement> {
  if (hasModalOpen()) {
    throw new Error('Предыдущее модальное окно ещё не закрыто');
  }

  setAutoStatus(`Открываю отзыв: ${truncate(candidate.title, 56)}...`);
  triedTitlesInCycle.add(candidate.title);

  await clickElement(candidate.clickTarget);

  const opened = await waitUntil(() => Boolean(getOpenReviewModal()), 7000, 120);
  if (!opened) {
    throw new Error('Не открылось окно отзыва');
  }

  await sleepRange(2000, 3000);

  const modal = getOpenReviewModal();
  if (!modal) {
    throw new Error('Модальное окно не найдено после открытия');
  }

  const ready = await waitUntil(() => {
    const currentModal = getOpenReviewModal();
    if (!currentModal) return false;
    return isModalFullyLoaded(currentModal);
  }, 5000, 150);

  if (!ready) {
    throw new Error('Модальное окно открылось не полностью');
  }

  const readyModal = getOpenReviewModal();
  if (!readyModal) {
    throw new Error('Модальное окно пропало после загрузки');
  }

  return readyModal;
}

function isCandidateHandled(candidate: ReviewRowCandidate): boolean {
  if (!document.contains(candidate.row)) return true;
  return getRowStatus(candidate.row) === 'Обработан';
}

function findSendReplyButton(modal: HTMLElement): HTMLButtonElement | null {
  const textarea = modal.querySelector<HTMLTextAreaElement>('#AnswerCommentForm');
  const allButtons = Array.from(modal.querySelectorAll<HTMLButtonElement>('button[type="submit"]')).filter(isElementVisible);

  const disallowedTexts = ['Сгенерировать', 'Ответить на отзыв', 'Написать в чат', 'Закрепить', 'Удалить', 'Редактировать'];
  const candidates = allButtons.filter((button) => {
    const text = normalizeText(button.innerText);
    return !disallowedTexts.some((part) => text.includes(part));
  });

  if (!textarea) {
    return candidates[0] ?? null;
  }

  const textareaRect = textarea.getBoundingClientRect();

  const nearest = candidates
    .map((button) => ({ button, rect: button.getBoundingClientRect() }))
    .filter(({ rect }) => rect.top >= textareaRect.top - 20 && rect.top <= textareaRect.bottom + 220)
    .sort((a, b) => {
      const scoreA = Math.abs(a.rect.top - textareaRect.bottom) + Math.abs(a.rect.left - textareaRect.right);
      const scoreB = Math.abs(b.rect.top - textareaRect.bottom) + Math.abs(b.rect.left - textareaRect.right);
      return scoreA - scoreB;
    });

  return nearest[0]?.button ?? candidates[candidates.length - 1] ?? null;
}

function findPostedSellerReplyBlock(modal: HTMLElement): HTMLElement | null {
  const blocks = Array.from(modal.querySelectorAll<HTMLElement>('div.n1d-p4')).filter(isElementVisible);

  for (const block of blocks) {
    const text = normalizeText(block.innerText);

    const hasDelete = text.includes('Удалить');
    const hasEdit = text.includes('Редактировать');
    const hasSellerReply =
      text.includes('Официальный представитель продавца') ||
      /ответ\s+/i.test(text) ||
      text.includes('На модерации');

    if ((hasDelete || hasEdit) && hasSellerReply) {
      return block;
    }
  }

  return null;
}

function hasPostedSellerReply(modal: HTMLElement, expectedReply?: string): boolean {
  const block = findPostedSellerReplyBlock(modal);
  if (!block) return false;

  if (!expectedReply) return true;

  const blockText = normalizeText(block.innerText);
  const expectedSample = normalizeText(expectedReply).slice(0, 80);

  return !expectedSample || blockText.includes(expectedSample);
}

function findCloseModalButton(modal: HTMLElement): HTMLButtonElement | null {
  const exact = modal.parentElement?.querySelector<HTMLButtonElement>('button.t7c80-a1.sc180-b5');
  if (exact && isElementVisible(exact)) {
    return exact;
  }

  const allButtons = Array.from(
    (modal.parentElement ?? document).querySelectorAll<HTMLButtonElement>('button[type="button"]')
  ).filter(isElementVisible);

  return (
    allButtons.find((button) => {
      const text = normalizeText(button.innerText);
      if (text) return false;
      return button.querySelector('svg') !== null;
    }) ?? null
  );
}

function fireRealClick(target: Element) {
  const common = { bubbles: true, cancelable: true, composed: true, view: window };

  try {
    target.dispatchEvent(
      new PointerEvent('pointerdown', {
        ...common,
        pointerId: 1,
        isPrimary: true,
        button: 0,
        buttons: 1
      })
    );
  } catch {}

  target.dispatchEvent(
    new MouseEvent('mousedown', {
      ...common,
      button: 0,
      buttons: 1
    })
  );

  try {
    target.dispatchEvent(
      new PointerEvent('pointerup', {
        ...common,
        pointerId: 1,
        isPrimary: true,
        button: 0,
        buttons: 0
      })
    );
  } catch {}

  target.dispatchEvent(
    new MouseEvent('mouseup', {
      ...common,
      button: 0,
      buttons: 0
    })
  );

  target.dispatchEvent(
    new MouseEvent('click', {
      ...common,
      button: 0,
      buttons: 0
    })
  );

  if (target instanceof HTMLElement) {
    target.click();
  }
}

function findModalBackdrop(modal: HTMLElement): HTMLElement | null {
  const root = modal.parentElement ?? modal;

  const rightBackdrop =
    root.querySelector<HTMLElement>('.tc280-a1.tc280-a3') ??
    root.querySelector<HTMLElement>('.tc280-a1.tc280-a2');

  if (rightBackdrop && isElementVisible(rightBackdrop)) {
    return rightBackdrop;
  }

  return null;
}

async function closeOpenModalStrictly() {
  const modal = getOpenReviewModal();
  if (!modal) return;

  const closeButton = findCloseModalButton(modal);
  if (!closeButton) {
    throw new Error('Не найдена кнопка закрытия модального окна');
  }

  setAutoStatus('Закрываю модальное окно...');

  fireRealClick(closeButton);

  let closed = await waitUntil(() => !getOpenReviewModal(), 1500, 150);
  if (closed) {
    await sleep(1000);
    return;
  }

  const closeSvg = closeButton.querySelector('svg');
  if (closeSvg) {
    fireRealClick(closeSvg);
    closed = await waitUntil(() => !getOpenReviewModal(), 1500, 150);
    if (closed) {
      await sleep(1000);
      return;
    }
  }

  const currentModal = getOpenReviewModal();
  if (currentModal) {
    const backdrop = findModalBackdrop(currentModal);
    if (backdrop) {
      fireRealClick(backdrop);
      closed = await waitUntil(() => !getOpenReviewModal(), 2500, 150);
      if (closed) {
        await sleep(1000);
        return;
      }
    }
  }

  throw new Error('Не удалось закрыть модальное окно ни по крестику, ни по фону');
}

async function recoverByReload(reason: string): Promise<never> {
  setAutoStatus(`${reason}. Перезагружаю страницу...`, 'warn');
  await setPersistentAutoModeEnabled(true);
  await sleepRange(900, 1600);
  window.location.reload();
  throw new Error(reason);
}

async function processCandidate(candidate: ReviewRowCandidate): Promise<boolean> {
  const modal = await openCandidate(candidate);
  const review = await extractReview(modal);
  const input = findReplyInput(modal);

  if (!normalizeText(review.reviewText) || !input) {
    await recoverByReload('Отзыв открылся не полностью');
  }

  const root = mountUiRoot(modal, getReviewSignature(modal));
  await generateAndInsertForCard(modal, root);

  const actualInput = findReplyInput(modal);
  const insertedText =
    actualInput instanceof HTMLTextAreaElement || actualInput instanceof HTMLInputElement
      ? normalizeText(actualInput.value)
      : normalizeText(root.dataset.generatedReply);

  if (!insertedText) {
    throw new Error('Ответ не вставился в поле');
  }

  await sleepRange(400, 900);

  const sendButton = findSendReplyButton(modal);
  if (!sendButton) {
    throw new Error('Не найдена кнопка отправки ответа');
  }

  setAutoStatus(`Отправляю ответ: ${truncate(candidate.title, 50)}...`);
  await clickElement(sendButton);

  await sleepRange(2000, 3000);

 const replyAppeared = await waitUntil(() => {
  const currentModal = getOpenReviewModal();
  if (!currentModal) return false;
  return hasPostedSellerReply(currentModal, insertedText);
}, 20000, 2000);

  if (!replyAppeared) {
    throw new Error('После отправки в модальном окне не появился опубликованный ответ');
  }

  setAutoStatus(`Ответ появился: ${truncate(candidate.title, 50)}. Закрываю окно...`, 'success');

  await sleep(1000);
  await closeOpenModalStrictly();

  return true;
}

async function startAutoMode() {
  if (autoState.running) return;

  autoState.enabled = true;
  autoState.stopRequested = false;
  autoState.batchTarget = randomInt(10, 15);
  autoState.processedInBatch = 0;
  autoState.refreshedWithoutWork = false;
  triedTitlesInCycle.clear();

  await setPersistentAutoModeEnabled(true);
  setAutoStatus('Автоответ запущен.');
  updateAutoControls();

  void runAutoModeLoop();
}

async function stopAutoMode(reason = 'Автоответ остановлен.') {
  autoState.enabled = false;
  autoState.stopRequested = true;
  await setPersistentAutoModeEnabled(false);
  setAutoStatus(reason);
  updateAutoControls();
}

async function runAutoModeLoop() {
  if (autoState.running) return;

  autoState.running = true;
  updateAutoControls();

  try {
    await ensureWaitingFilterActive();

    while (autoState.enabled && !autoState.stopRequested) {
      ensureAutoControls();

      if (hasModalOpen()) {
        setAutoStatus('Жду закрытия текущего модального окна...');
        const closed = await waitUntil(() => !hasModalOpen(), 8000, 150);
        if (!closed) {
          throw new Error('Модальное окно не закрылось вовремя');
        }
        await sleep(1000);
      }

      if (autoState.processedInBatch >= autoState.batchTarget) {
        await refreshWaitingFilter();
      }

      const candidate = pickNextCandidate();

      if (!candidate) {
        if (autoState.refreshedWithoutWork) {
          await stopAutoMode('Подходящие отзывы не найдены.');
          break;
        }

        autoState.refreshedWithoutWork = true;
        await refreshWaitingFilter();
        continue;
      }

      autoState.refreshedWithoutWork = false;

      try {
        const success = await processCandidate(candidate);

        if (success) {
          autoState.totalProcessed += 1;
          autoState.processedInBatch += 1;

          setAutoStatus(
            `Обработано ${autoState.totalProcessed}. В текущем цикле ${autoState.processedInBatch}/${autoState.batchTarget}.`,
            'success'
          );

          await sleep(1000);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Ошибка автоответа';
        setAutoStatus(message, 'error');

        if (hasModalOpen()) {
          try {
            await closeOpenModalStrictly();
          } catch (closeError) {
            console.warn('[Finerox Auto Reply] failed to close modal after error', closeError);
          }
        }

        await sleepRange(1200, 2200);
      }
    }
  } finally {
    autoState.running = false;
    updateAutoControls();
  }
}

async function initAutoMode() {
  if (!isReviewPage()) return;

  ensureAutoControls();

  const enabled = await getPersistentAutoModeEnabled();
  if (!enabled) return;

  autoState.enabled = true;
  autoState.stopRequested = false;
  setAutoStatus('Восстанавливаю автоответ после перезагрузки...');
  updateAutoControls();

  window.setTimeout(() => {
    void runAutoModeLoop();
  }, 1400);
}

void bindCards();
window.setTimeout(() => void bindCards(), 300);
window.setTimeout(() => void bindCards(), 1000);
window.setTimeout(() => ensureAutoControls(), 300);
window.setTimeout(() => ensureAutoControls(), 1000);
initObserver();
void initAutoMode();